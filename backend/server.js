// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');
const db = require('./db');
const util = require('util');
const execFileAsync = util.promisify(execFile);

const app = express();
const port = 3001;

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

app.use(cors());
app.use(express.json());

app.get('/api/stock/:symbol', async (req, res) => {

  try {
    const { symbol } = req.params;
    const { date_range = 'max', interval = '1d', auto_predict = 'false' } = req.query;
    
    const cacheKey = `${symbol}-${date_range}-${interval}-${auto_predict}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL)) {
      console.log('Returning cached data for:', cacheKey);
      return res.json(cachedData.data);
    }
    
    const pythonArgs = [path.join(__dirname, '../analysis/stock_data.py'), 'get_stock_price_history', symbol, date_range, interval, auto_predict];
  
    execFile('python', pythonArgs,{maxBuffer:1024*1024*10}, (error, stdout, stderr) => {
      if (error) {
        console.error('Error executing Python script:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }

      console.log('Python stdout length:', stdout.length);
      console.log('Python stderr:', stderr);

      try {
        const result = JSON.parse(stdout);
        
        // Cache the result
        cache.set(cacheKey, {
          timestamp: Date.now(),
          data: result
        });

        res.json(result);
      } catch (parseError) {
        console.error('Error parsing Python output:', parseError);
        res.status(500).json({ error: 'Invalid data format from Python script' });
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    let { symbol, price, amount } = req.body;
    const queryText = 'INSERT INTO orders (type, symbol, price, amount, status) VALUES ($1, $2, $3, $4, $5) RETURNING price';
    const values = ['buy', symbol, price, amount, false];
    const dbResult = await db.query(queryText, values);
    const finalPrice = dbResult.rows[0].price;
    res.json({ success: true, message: 'Order submitted successfully', price: finalPrice });

  } catch (error) {
    console.error('Error submitting order:', error);
    res.status(500).json({ error: 'Failed to submit order' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
