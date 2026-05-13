const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const port = 8000;

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./mangal_sons.db');

// 1. HOME ROUTE: Shows the Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. GET ALL INVENTORY
app.get('/api/inventory', (req, res) => {
    db.all("SELECT * FROM products ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 3. GET SINGLE PRODUCT
app.get('/api/product/:barcode', (req, res) => {
    db.get("SELECT * FROM products WHERE barcode_id = ?", [req.params.barcode], (err, row) => {
        if (row) { res.json(row); } else { res.status(404).json({ message: "Not found" }); }
    });
});

// 4. ADD PRODUCT
app.post('/api/product/add', (req, res) => {
    const { barcode_id, name, category, cost_price, selling_price, stock_qty } = req.body;
    db.run(`INSERT INTO products (barcode_id, name, category, cost_price, selling_price, stock_qty) VALUES (?, ?, ?, ?, ?, ?)`,
        [barcode_id, name, category, cost_price, selling_price, stock_qty], function(err) {
            if (err) return res.status(400).json({ error: err.message });
            res.json({ message: "Success" });
        });
});

app.listen(port, () => {
    console.log(`Server started at http://localhost:${port}`);
});