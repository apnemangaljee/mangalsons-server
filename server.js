const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 

// Connect to the Permanent Neon Database
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Create the inventory table if it doesn't exist
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
        console.log("Cloud Database connected and ready!");
    } catch (err) {
        console.error("Database connection error:", err);
    }
};
initDB();

// 1. GET ALL INVENTORY
app.get('/api/inventory', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. GET SINGLE PRODUCT
app.get('/api/product/:barcode', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products WHERE barcode_id = $1', [req.params.barcode]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. ADD OR UPDATE PRODUCT
app.post('/api/product/add', async (req, res) => {
    const { barcode_id, name, category, cost_price, selling_price, stock_qty } = req.body;
    try {
        const query = `
            INSERT INTO products (barcode_id, name, category, cost_price, selling_price, stock_qty)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (barcode_id) 
            DO UPDATE SET 
                name = EXCLUDED.name,
                category = EXCLUDED.category,
                cost_price = EXCLUDED.cost_price,
                selling_price = EXCLUDED.selling_price,
                stock_qty = EXCLUDED.stock_qty
        `;
        await pool.query(query, [barcode_id, name, category, cost_price, selling_price, stock_qty]);
        res.json({ message: 'Product saved permanently!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
