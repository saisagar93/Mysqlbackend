const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const passport = require('passport');
require('dotenv').config();
require('./passport');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
}));
app.use(bodyParser.json());

// MySQL connection setup
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
});

db.connect((err) => {
    if (err) {
        throw err;
    }
    console.log('MySQL Connected...');
});

// Configure Nodemailer
const transporter = nodemailer.createTransport({
    service: 'Outlook365',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Function to send email
const sendEmail = (message) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: 'Sagar.b@bayanattechnology.com',
        subject: 'JMCC Dashboard Alert',
        text: message,
    };

    return transporter.sendMail(mailOptions);
};

//login 
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT * FROM SEC_LOGIN WHERE username = ? AND password = ?';

    db.execute(query, [username, password], (err, results) => {
        if (err) return res.status(500).send(err);

        if (results.length > 0) {
            // Create a JWT token
            const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1d' });
            return res.json({ message: 'Successfully logged in!', token });
        } else {
            res.status(401).json({ message: 'Invalid credentials.' });
        }
    });
});

// Protected routes
app.post('/addRecord', passport.authenticate('jwt', { session: false }), (req, res) => {
    const recordData = req.body;
    const query = `INSERT INTO JMCC_LIST (tracker, sjm, journey_Plane_No, journey_Plane_Date, scheduled_Vehicle, carrier, jp_Status, next_Arrival_Date, next_Point, ivms_Check_Date, ivms_Point, destination, offload_Point, driver_Name, remarks, accommodation, jm, item_Type) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.execute(query, [
        recordData.tracker ?? null, recordData.sjm ?? null, recordData.journey_Plane_No ?? null,
        recordData.journey_Plane_Date ?? null, recordData.scheduled_Vehicle ?? null, recordData.carrier ?? null,
        recordData.jp_Status ?? null, recordData.next_Arrival_Date ?? null, recordData.next_Point ?? null,
        recordData.ivms_Check_Date ?? null, recordData.ivms_Point ?? null, recordData.destination ?? null,
        recordData.offload_Point ?? null, recordData.driver_Name ?? null, recordData.remarks ?? null,
        recordData.accommodation ?? null, recordData.jm ?? null, recordData.item_Type ?? null,
    ], (err, results) => {
        if (err) return res.status(500).json({ message: 'Error inserting record.' });
        res.json({ message: 'Record added successfully!' });
    });
});

// Fetch records
app.get('/dashboard', passport.authenticate('jwt', { session: false }), (req, res) => {
    db.query('SELECT * FROM JMCC_LIST', (err, results) => {
        if (err) return res.status(500).json({ message: 'Error fetching dashboard data.' });
        res.json(results);
    });
});

// Modify records
app.put('/modifyRecord/:journeyPlaneNo', passport.authenticate('jwt', { session: false }), (req, res) => {
    const journeyPlaneNo = req.params.journeyPlaneNo;
    const updatedData = req.body;

    const query = `UPDATE JMCC_LIST SET 
                   tracker = ?, sjm = ?, journey_Plane_No = ?, journey_Plane_Date = ?, 
                   scheduled_Vehicle = ?, carrier = ?, jp_Status = ?, 
                   next_Arrival_Date = ?, next_Point = ?, ivms_Check_Date = ?, 
                   ivms_Point = ?, destination = ?, offload_Point = ?, 
                   driver_Name = ?, remarks = ?, accommodation = ?, 
                   jm = ?, item_Type = ? 
                   WHERE journey_Plane_No = ?`;

    db.execute(query, [
        updatedData.tracker ?? null, updatedData.sjm ?? null, journeyPlaneNo,
        updatedData.journey_Plane_Date ?? null, updatedData.scheduled_Vehicle ?? null,
        updatedData.carrier ?? null, updatedData.jp_Status ?? null,
        updatedData.next_Arrival_Date ?? null, updatedData.next_Point ?? null,
        updatedData.ivms_Check_Date ?? null, updatedData.ivms_Point ?? null,
        updatedData.destination ?? null, updatedData.offload_Point ?? null,
        updatedData.driver_Name ?? null, updatedData.remarks ?? null,
        updatedData.accommodation ?? null, updatedData.jm ?? null,
        updatedData.item_Type ?? null, journeyPlaneNo,
    ], (err, results) => {
        if (err) return res.status(500).json({ message: 'Error updating record.' });
        res.json({ message: 'Record updated successfully!' });
    });
});

// Delete record route
app.delete('/deleteRecord/:journeyPlaneNo', passport.authenticate('jwt', { session: false }), (req, res) => {
    const journeyPlaneNo = req.params.journeyPlaneNo;

    const query = `DELETE FROM JMCC_LIST WHERE journey_Plane_No = ?`;

    db.execute(query, [journeyPlaneNo], (err, results) => {
        if (err) return res.status(500).json({ message: 'Error deleting record.' });
        res.json({ message: 'Record deleted successfully!' });
    });
});

// Email sending route
app.post('/sendEmail', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const { message } = req.body;
    console.log(message);
    if (!message) {
        return res.status(400).json({ message: 'Message content is required.' });
    }

    try {
        await sendEmail(message); // Ensure sendEmail handles the email sending logic
        res.json({ message: 'Email sent successfully!' });
    } catch (error) {
        console.error('Error sending email:', error); // Log error for debugging
        res.status(500).json({ message: 'Error sending email.' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
