// server.js
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

app.get('/api/stock/:symbol', async (req, res) => {


  try {
    const { symbol } = req.params;
    const pythonArgs = ['../analysis/sma_calculator.py', 'get_stock_price_history', symbol];
  
    execFile('python', pythonArgs,{maxBuffer:1024*2024*10}, (error, stdout, stderr) => {
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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
