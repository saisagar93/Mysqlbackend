const passport = require('passport');
const passportJWT = require('passport-jwt');
const mysql = require('mysql2');
require('dotenv').config();

const JWTStrategy = passportJWT.Strategy;
const ExtractJWT = passportJWT.ExtractJwt;

// MySQL connection setup
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
});

// Setup options for JWT strategy
const options = {
    jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(), // Extract JWT from Bearer token
    secretOrKey: process.env.JWT_SECRET, // Your JWT secret
};

// Create JWT strategy
passport.use(
    new JWTStrategy(options, (jwtPayload, done) => {
        // Find user based on the username from the token payload
        const query = 'SELECT * FROM SEC_LOGIN WHERE username = ?';
        db.execute(query, [jwtPayload.username], (err, results) => {
            if (err) {
                return done(err, false); // Handle errors
            }

            if (results.length > 0) {
                return done(null, results[0]); // User found
            } else {
                return done(null, false); // User not found
            }
        });
    })
);

module.exports = passport; // Export passport for use in other files
