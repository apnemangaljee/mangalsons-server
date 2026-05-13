const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection (Neon PostgreSQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ====================================================
// PHASE 1 & 2: INVENTORY & PRODUCT MANAGEMENT
// ====================================================

// Get all inventory
app.get('/api/inventory', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get a single product by barcode
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

// Add or Update a product
app.post('/api/product/add', async (req, res) => {
    const { barcode_id, name, category, cost_price, selling_price, stock_qty } = req.body;
    try {
        await pool.query(`
            INSERT INTO products (barcode_id, name, category, cost_price, selling_price, stock_qty)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (barcode_id) 
            DO UPDATE SET 
                name = EXCLUDED.name,
                cost_price = EXCLUDED.cost_price,
                selling_price = EXCLUDED.selling_price,
                stock_qty = EXCLUDED.stock_qty
        `, [barcode_id, name, category, cost_price, selling_price, stock_qty]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ====================================================
// PHASE 1 & 4: CHECKOUT & SALES (CASH + UDHAAR)
// ====================================================

app.post('/api/checkout', async (req, res) => {
    const { total_amount, items, customer_id } = req.body;
    
    try {
        // 1. Save the receipt
        const saleResult = await pool.query(
            'INSERT INTO sales (total_amount, items) VALUES ($1, $2) RETURNING id',
            [total_amount, JSON.stringify(items)]
        );

        // 2. Deduct stock for all items purchased
        for (let item of items) {
            await pool.query(
                'UPDATE products SET stock_qty = stock_qty - $1 WHERE barcode_id = $2',
                [item.qty, item.barcode_id]
            );
        }

        // 3. If this is a Khata (Credit) sale, update the customer's pending balance
        if (customer_id) {
            await pool.query(
                'UPDATE customers SET balance = balance + $1 WHERE id = $2',
                [total_amount, customer_id]
            );
        }

        res.json({ success: true, sale_id: saleResult.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ====================================================
// PHASE 3: MANAGER ANALYTICS DASHBOARD
// ====================================================

app.get('/api/analytics', async (req, res) => {
    try {
        // Calculate Today's Revenue and Total Bills
        const salesResult = await pool.query(`
            SELECT COALESCE(SUM(total_amount), 0) as today_sales, COUNT(id) as total_bills 
            FROM sales 
            WHERE DATE(created_at) = CURRENT_DATE
        `);
        
        // Count items low on stock
        const lowStockResult = await pool.query(`
            SELECT COUNT(barcode_id) as low_stock_count 
            FROM products 
            WHERE stock_qty <= 2
        `);

        res.json({
            today_sales: parseFloat(salesResult.rows[0].today_sales),
            total_bills: parseInt(salesResult.rows[0].total_bills),
            low_stock_count: parseInt(lowStockResult.rows[0].low_stock_count)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ====================================================
// PHASE 4: KHATA (CUSTOMER LEDGER)
// ====================================================

// Get all customers and their balances
app.get('/api/customers', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM customers ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add a new customer
app.post('/api/customers', async (req, res) => {
    try {
        const { name, phone } = req.body;
        await pool.query('INSERT INTO customers (name, phone) VALUES ($1, $2)', [name, phone]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Receive payment (Clear Dues)
app.post('/api/customers/pay', async (req, res) => {
    try {
        const { customer_id, amount } = req.body;
        await pool.query('UPDATE customers SET balance = balance - $1 WHERE id = $2', [amount, customer_id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ====================================================
// START SERVER
// ====================================================
app.listen(port, () => {
    console.log(`Mangal & Sons Server running on port ${port}`);
});
