// server.js
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');
const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

app.get('/api/stock/:symbol', async (req, res) => {

  try {
    const { symbol } = req.params;
    const { date_range = 'max', interval = '1d', auto_predict = 'false' } = req.query;
    
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
app.get('/api/stocks/search', async (req, res) => {
  try {
    const { q: query } = req.query;
    const pythonArgs = [path.join(__dirname, '../analysis/stock_data.py'), 'search_stocks', query];
  
    execFile('python', pythonArgs, {maxBuffer:1024*1024*5}, (error, stdout, stderr) => {
      if (error) {
        console.error('Error executing Python script:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }

      try {
        const result = JSON.parse(stdout);
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
app.get('/api/stocks/getallsysmbol', async (req, res) => {
  try {
    const pythonArgs = [path.join(__dirname, '../analysis/stock_data.py'), 'get_all_symbols'];
  
    execFile('python', pythonArgs, {maxBuffer:1024*1024*50}, (error, stdout, stderr) => {
      if (error) {
        console.error('Error executing Python script:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }

      try {
        const result = JSON.parse(stdout);
        res.json(result);
      } catch (parseError) {
        console.error('Error parsing Python output:', parseError);
        res.status(500).json({ error: 'Invalid data format from Python script' });
      }
    });

  }
  catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
