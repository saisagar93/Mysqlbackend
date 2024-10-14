const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const passport = require('passport');
const moment = require('moment-timezone');
require('dotenv').config();
require('./passport');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
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
    timezone: 'Z',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.connect((err) => {
    if (err) {
        console.error('MySQL connection error:', err);
        process.exit(1);
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

const sendEmail = (recipients, message, isHtml = false) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: recipients.join(', '),
        subject: 'JMCC Dashboard Alert',
        text: isHtml ? undefined : message, // Use text only if not HTML
        html: isHtml ? message : undefined // Use HTML if isHtml is true
    };
    return transporter.sendMail(mailOptions);
};


//Function to normalize string inputs
const normalizeString = (str) => {
    return str ? str.trim().toLowerCase() : '';
};

// Function to normalize the records
const normalizeRecords = (records) => {
    return records.map(item => ({
        ...item,
        JP_STATUS: normalizeString(item.JP_STATUS),
        REMARKS: normalizeString(item.REMARKS),
        IVMS_CHECK_DATE: item.IVMS_CHECK_DATE // Keep original date format for calculations
    }));
};

// Function to calculate minutes since last check
const calculateMinutesSinceLastCheck = (ivmsCheckDate) => {
    if (!ivmsCheckDate) return Infinity;
    const currentTime = moment.tz("Asia/Muscat");
    const checkTime = moment(ivmsCheckDate);
    return currentTime.diff(checkTime, 'minutes');
};

// Function to check conditions and send emails
const checkConditionsAndSendEmails = (filteredRecords) => {
    // Normalize the records before processing
    const normalizedRecords = normalizeRecords(filteredRecords);

    const cardCounts = {
        criticalCheck: normalizedRecords.filter(item => {
            const minutesSinceLastCheck = calculateMinutesSinceLastCheck(item.IVMS_CHECK_DATE);
            return (
                minutesSinceLastCheck > 120 &&
                item.REMARKS !== "done" &&
                item.JP_STATUS !== "closed"
            );
        }).length,

        dueForChecking: normalizedRecords.filter(item => {
            const minutesSinceLastCheck = calculateMinutesSinceLastCheck(item.IVMS_CHECK_DATE);
            const isValidHours = (minutesSinceLastCheck > 60 && minutesSinceLastCheck < 120) || isNaN(minutesSinceLastCheck);
            return isValidHours && item.JP_STATUS !== "closed" && item.REMARKS !== "done";
        }).length,

        liveJourneys: normalizedRecords.filter(item => ["in transit"].includes(item.JP_STATUS)).length,
        stoppedTrucks: normalizedRecords.filter(item => item.REMARKS === "done" && item.JP_STATUS !== "closed").length,
        Stoppedforday: normalizedRecords.filter(item => item.REMARKS === "done" && item.JP_STATUS !== "closed").length,
    };

    const journeyDetails = normalizedRecords;

    if (cardCounts.criticalCheck > 0) {
        const criticalJourneyDetails = journeyDetails.filter(item => {
            const minutesSinceLastCheck = calculateMinutesSinceLastCheck(item.IVMS_CHECK_DATE);
            return (
                minutesSinceLastCheck > 120 &&
                item.REMARKS !== "done" &&
                item.JP_STATUS === "in transit"
            );
        });

        const emailContent = criticalJourneyDetails.map(item =>
            `JOURNEY PLAN NO:<strong> ${item.JOURNEY_PLANE_NO} </strong>`
        ).join('<br>');

        const recipients = ["JMCC-AMLS@almadinalogistics.com","duqmoperationteam2@almadinalogistics.com","naderhakim@almadinalogistics.com"];
        const emailBody = `<span style="font-size: 16px;"><strong>Below Journeys In The Critical Check:</strong></span><br>${emailContent}`;
        
        sendEmail(recipients, emailBody, { isHtml: true });
    }

    // Check if more than half of live journeys are due for checking
    if (cardCounts.liveJourneys > 0 && cardCounts.dueForChecking >= cardCounts.liveJourneys / 2) {
        const emailBody = '<span style="font-size: 16px;"><strong>More than half of live journeys are due for checking.</strong></span>';
        sendEmail(["JMCC-AMLS@almadinalogistics.com","duqmoperationteam2@almadinalogistics.com","naderhakim@almadinalogistics.com"], emailBody, { isHtml: true });
    }

    // Check if live journeys equal stopped trucks
    if (cardCounts.liveJourneys === cardCounts.stoppedTrucks && cardCounts.liveJourneys > 0) {
        const liveJourneyIds = new Set(journeyDetails.map(item => item.JOURNEY_PLANE_NO));
        const stoppedTruckIds = new Set(journeyDetails.filter(item => item.REMARKS === "done").map(item => item.JOURNEY_PLANE_NO));

        const hasSameItems = [...liveJourneyIds].every(id => stoppedTruckIds.has(id)) &&
                             [...stoppedTruckIds].every(id => liveJourneyIds.has(id));

        if (hasSameItems) {
            const emailBody = '<span style="font-size: 16px;"><strong>Live journeys and stopped trucks counts are equal, with matching items.</strong></span>';
            sendEmail(["JMCC-AMLS@almadinalogistics.com","duqmoperationteam2@almadinalogistics.com","naderhakim@almadinalogistics.com"], emailBody, { isHtml: true });
        }
    }

    // Count SJM occurrences
    const sjmCounts = {};  
    normalizedRecords.forEach(item => {
        if (item.SJM) {
            sjmCounts[item.SJM] = (sjmCounts[item.SJM] || 0) + 1;
        }
    });

    for (const [sjmName, count] of Object.entries(sjmCounts)) {
        if (count > 30) {
            const emailBody = `<span style="font-size: 16px;"><strong>SJM ${sjmName} Currently Has More Than 30 Live Journeys.</strong></span>`;
            sendEmail(["JMCC-AMLS@almadinalogistics.com","duqmoperationteam2@almadinalogistics.com","naderhakim@almadinalogistics.com"], emailBody, { isHtml: true });
        }
    }

    // Stopped for the day
    if (cardCounts.Stoppedforday > 0) {
        const Stoppedforday = journeyDetails.filter(item => 
            item.REMARKS === "done" && item.JP_STATUS === "in transit"
        );

        const emailContent = Stoppedforday.map(item =>
            `JOURNEY PLAN NO: <strong> ${item.JOURNEY_PLANE_NO} </strong>`
        ).join('<br>');

        const recipients = ["JMCC-AMLS@almadinalogistics.com","duqmoperationteam2@almadinalogistics.com","naderhakim@almadinalogistics.com"];
        const emailBody = `<span style="font-size: 16px;"><strong>Below Journeys Stopped For The Day:</strong></span><br>${emailContent}`;
        
        sendEmail(recipients, emailBody, { isHtml: true });
    }
};

// Login Route
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT * FROM SEC_LOGIN WHERE username = ? AND password = ?';

    db.execute(query, [username, password], (err, results) => {
        if (err) return res.status(500).json({ message: 'Database error.' });

        if (results.length > 0) {
            const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1d' });
            return res.json({ message: 'Successfully logged in!', token });
        } else {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
    });
});

// Signup Route
app.post("/Signup", (req, res) => {
    const { username, email, password } = req.body;
    const query = `INSERT INTO SEC_LOGIN (username,email,password) VALUES (?, ?, ?)`;

    db.execute(query, [username, email, password], (err, results) => {
        console.log(err, results);

        if (err)
            return res.status(500).json({ message: "Error inserting record." });
        res.json({ message: "Record added successfully!" });
    });
});

// Protected Route for Dropdown
app.get('/dashboarddropdown', passport.authenticate('jwt', { session: false }), (req, res) => {
    db.query('SELECT DISTINCT tracker, sjm, journey_Plane_No, scheduled_Vehicle, carrier, remarks, next_Point, ivms_Point, destination, offload_Point, driver_Name FROM JMCC_LIST', (err, results) => {
        if (err) return res.status(500).json({ message: 'Error fetching dropdown data.' });
        res.json(results);
    });
});

const formatDateForMySQL = (dateString) => {
    const date = new Date(dateString);
    console.log('DATE',date);

    return date.toISOString().slice(0, 19).replace('T', ' ');
};

app.post('/addRecord', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const recordData = req.body;

    // Format dates for MySQL
    recordData.journey_Plane_Date = formatDateForMySQL(recordData.journey_Plane_Date);
    recordData.next_Arrival_Date = formatDateForMySQL(recordData.next_Arrival_Date);
    recordData.ivms_Check_Date = formatDateForMySQL(recordData.ivms_Check_Date);

    // Check if journey_Plane_No already exists
    const checkQuery = `SELECT * FROM JMCC_LIST WHERE journey_Plane_No = ?`;
    db.execute(checkQuery, [recordData.journey_Plane_No], (err, results) => {
        if (err) {
            console.error('Error checking for existing record:', err);
            return res.status(500).json({ message: 'Error checking for existing record.', error: err.message });
        }

        // If the record exists, send an appropriate message
        if (results.length > 0) {
            return res.status(409).json({ message: 'Journey Plane No already exists.' });
        }

        // Proceed with the insertion if it does not exist
        const insertQuery = `INSERT INTO JMCC_LIST (tracker, sjm, journey_Plane_No, journey_Plane_Date, scheduled_Vehicle, carrier, jp_Status, next_Arrival_Date, next_Point, ivms_Check_Date, ivms_Point, destination, offload_Point, driver_Name, remarks, accommodation, jm, item_Type) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        db.execute(insertQuery, [
            recordData.tracker ?? null,
            recordData.sjm ?? null,
            recordData.journey_Plane_No ?? null,
            recordData.journey_Plane_Date ?? null,
            recordData.scheduled_Vehicle ?? null,
            recordData.carrier ?? null,
            recordData.jp_Status ?? null,
            recordData.next_Arrival_Date ?? null,
            recordData.next_Point ?? null,
            recordData.ivms_Check_Date ?? null,
            recordData.ivms_Point ?? null,
            recordData.destination ?? null,
            recordData.offload_Point ?? null,
            recordData.driver_Name ?? null,
            recordData.remarks ?? null,
            recordData.accommodation ?? null,
            recordData.jm ?? null,
            recordData.item_Type ?? null,
        ], (err, results) => {
            if (err) {
                console.error('Database insertion error:', err);
                return res.status(500).json({ message: 'Error inserting record.', error: err.message });
            }

            res.json({ message: 'Record added successfully!' });
        });
    });
});


// Fetch Records
app.get('/dashboard', passport.authenticate('jwt', { session: false }), (req, res) => {
    db.query('SELECT * FROM JMCC_LIST', (err, results) => {
        if (err) return res.status(500).json({ message: 'Error fetching dashboard data.' });

        res.json(results);
    });
});


//Modify for React Grid 
app.patch('/modifyRecordsBatch', passport.authenticate('jwt', { session: false }), (req, res) => {
    const updatedDataArray = req.body; // Expecting an array of updated records

    console.log('Received updated records:', updatedDataArray);

    // Validate input
    if (!Array.isArray(updatedDataArray) || updatedDataArray.length === 0) {
        return res.status(400).json({ message: 'Please Make Changes Before Saving.' });
    }

    // Prepare an array to hold update promises
    const updatePromises = updatedDataArray.map(updatedData => {
        // Convert dates to UTC (if provided)
        if (updatedData.JOURNEY_PLANE_DATE) {
            updatedData.JOURNEY_PLANE_DATE = formatDateForMySQL(updatedData.JOURNEY_PLANE_DATE);
        }
        if (updatedData.NEXT_ARRIVAL_DATE) {
            updatedData.NEXT_ARRIVAL_DATE = formatDateForMySQL(updatedData.NEXT_ARRIVAL_DATE);
        }
        if (updatedData.IVMS_CHECK_DATE) {
            updatedData.IVMS_CHECK_DATE = formatDateForMySQL(updatedData.IVMS_CHECK_DATE);
        }
     
        const query = `UPDATE JMCC_LIST SET 
            tracker = ?, sjm = ?, journey_Plane_No = ?, journey_Plane_Date = ?, 
            scheduled_Vehicle = ?, carrier = ?, jp_Status = ?, 
            next_Arrival_Date = ?, next_Point = ?, ivms_Check_Date = ?, 
            ivms_Point = ?, destination = ?, offload_Point = ?, 
            driver_Name = ?, remarks = ?, accommodation = ?, 
            jm = ?, item_Type = ? 
            WHERE journey_Plane_No = ?`;

        // Return a promise for each update
        return new Promise((resolve, reject) => {
            db.execute(query, [
                        updatedData.TRACKER ?? null,
                        updatedData.SJM ?? null,
                        updatedData.JOURNEY_PLANE_NO, // Ensure this is populated
                        updatedData.JOURNEY_PLANE_DATE ?? null,
                        updatedData.SCHEDULED_VEHICLE ?? null,
                        updatedData.CARRIER ?? null,
                        updatedData.JP_STATUS ?? null,
                        updatedData.NEXT_ARRIVAL_DATE ?? null,
                        updatedData.NEXT_POINT ?? null,
                        updatedData.IVMS_CHECK_DATE ?? null,
                        updatedData.IVMS_POINT ?? null,
                        updatedData.DESTINATION ?? null,
                        updatedData.OFFLOAD_POINT ?? null,
                        updatedData.DRIVER_NAME ?? null,
                        updatedData.REMARKS ?? null,
                        updatedData.ACCOMMODATION ?? null,
                        updatedData.JM ?? null,
                        updatedData.ITEM_TYPE ?? null,
                        updatedData.JOURNEY_PLANE_NO
            ].map(param => param === undefined ? null : param), (err, results) => {
                if (err) {
                    console.error('Error updating record for:', updatedData.JOURNEY_PLANE_NO, err);
                    reject(err); // Reject promise on error
                } else {
                    if (results.affectedRows === 0) {
                        console.log('No records were updated for:', updatedData.JOURNEY_PLANE_NO);
                    } else {
                        console.log('Record updated for:', updatedData.JOURNEY_PLANE_NO);
                    }
                    resolve(results); // Resolve promise on success
                }
            });
        });
    });

    // Execute all update promises
    Promise.all(updatePromises)
        .then(() => {
            // Fetch updated records after all updates are successful
            console.log("HELLO");
            
            db.query("SELECT * FROM JMCC_LIST WHERE LOWER(JP_STATUS) = 'IN TRANSIT'", (err, allRecords) => {
                if (err) {
                    console.error('Error fetching records:', err);
                    return res.status(500).json({ message: 'Error fetching records.' });   
                }
                
                checkConditionsAndSendEmails(allRecords);
                
                res.json({ message: 'Records updated successfully!' });
            });
            
        }
       
    )
        .catch(err => {
            console.error('Error during batch update:', err);
            res.status(500).json({ message: 'Error updating records in batch.' });
        });
});

// Modify Records
app.put('/modifyRecord/:journeyPlaneNo', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const journeyPlaneNo = req.params.journeyPlaneNo;
    const updatedData = req.body;

    // Convert dates to UTC
    updatedData.journey_Plane_Date = formatDateForMySQL(updatedData.journey_Plane_Date);
    updatedData.next_Arrival_Date = formatDateForMySQL(updatedData.next_Arrival_Date);
    updatedData.ivms_Check_Date = formatDateForMySQL(updatedData.ivms_Check_Date);

    const query = `UPDATE JMCC_LIST SET 
                   tracker = ?, sjm = ?, journey_Plane_No = ?, journey_Plane_Date = ?, 
                   scheduled_Vehicle = ?, carrier = ?, jp_Status = ?, 
                   next_Arrival_Date = ?, next_Point = ?, ivms_Check_Date = ?, 
                   ivms_Point = ?, destination = ?, offload_Point = ?, 
                   driver_Name = ?, remarks = ?, accommodation = ?, 
                   jm = ?, item_Type = ? 
                   WHERE journey_Plane_No = ?`;

    db.execute(query, [
        updatedData.tracker ?? null,
        updatedData.sjm ?? null,
        journeyPlaneNo,
        updatedData.journey_Plane_Date ?? null,
        updatedData.scheduled_Vehicle ?? null,
        updatedData.carrier ?? null,
        updatedData.jp_Status ?? null,
        updatedData.next_Arrival_Date ?? null,
        updatedData.next_Point ?? null,
        updatedData.ivms_Check_Date ?? null,
        updatedData.ivms_Point ?? null,
        updatedData.destination ?? null,
        updatedData.offload_Point ?? null,
        updatedData.driver_Name ?? null,
        updatedData.remarks ?? null,
        updatedData.accommodation ?? null,
        updatedData.jm ?? null,
        updatedData.item_Type ?? null,
        journeyPlaneNo,
    ], async (err, results) => {
        if (err) return res.status(500).json({ message: 'Error updating record.' });

        // Fetch updated records and check conditions
        db.query("SELECT * FROM JMCC_LIST WHERE LOWER(JP_STATUS) = 'IN TRANSIT'", async (err, allRecords) => { 
            if (err) {
                return res.status(500).json({ message: 'Error fetching records.' });
            }
            checkConditionsAndSendEmails(allRecords);
        });
        
        res.json({ message: 'Record updated successfully!' });
    });
});


// Delete Record
app.delete('/deleteRecord/:journeyPlaneNo', passport.authenticate('jwt', { session: false }), (req, res) => {
    const journeyPlaneNo = req.params.journeyPlaneNo;

    const query = `DELETE FROM JMCC_LIST WHERE journey_Plane_No = ?`;

    db.execute(query, [journeyPlaneNo], (err, results) => {
        if (err) return res.status(500).json({ message: 'Error deleting record.' });
        res.json({ message: 'Record deleted successfully!' });
    });
});

// Health check endpoint
app.get('/health-check', (req, res) => {
    return res.status(200).send('Server is running');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});  