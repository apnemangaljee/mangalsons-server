const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// Connect to your Neon Cloud Database
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// This part creates the new "shelves" (columns) for Cost and Stock
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                barcode_id TEXT PRIMARY KEY,
                name TEXT,
                category TEXT,
                cost_price NUMERIC,
                selling_price NUMERIC,
                stock_qty INTEGER
            )
        `);
        console.log("Cloud Database is updated with Cost and Stock columns!");
    } catch (err) {
        console.error("Database error:", err);
    }
};
initDB();

// API to get the full list
// This is the code that "answers" the phone when the app scans a barcode
app.get('/api/product/:barcode', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products WHERE barcode_id = $1', [req.params.barcode]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]); // This sends the price and stock back to the phone
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// API to save the new data (Cost, Selling, and Stock)
app.post('/api/product/add', async (req, res) => {
    const { barcode_id, name, category, cost_price, selling_price, stock_qty } = req.body;
    try {
        const query = `
            INSERT INTO products (barcode_id, name, category, cost_price, selling_price, stock_qty)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (barcode_id) 
            DO UPDATE SET 
                name = EXCLUDED.name,
                cost_price = EXCLUDED.cost_price,
                selling_price = EXCLUDED.selling_price,
                stock_qty = EXCLUDED.stock_qty
        `;
        await pool.query(query, [barcode_id, name, category, cost_price, selling_price, stock_qty]);
        res.json({ message: 'Saved successfully!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Server is live on port ${port}`);
});
