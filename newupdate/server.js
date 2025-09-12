// server.js
import express from 'express';
import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import dotenv from 'dotenv';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';

dotenv.config();

const app = express();
const port = 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json()); // Middleware to parse JSON bodies

// --- MongoDB Connection ---
let db;
const client = new MongoClient(process.env.MONGO_URI);

async function connectToMongo() {
    try {
        await client.connect();
        console.log('[LOG] Successfully connected to MongoDB.');
        db = client.db('metromithra'); // Use a database named 'metromithra'
    } catch (err) {
        console.error('[ERROR] Failed to connect to MongoDB:', err);
        process.exit(1); // Exit if we can't connect to the DB
    }
}

connectToMongo();


// --- Authentication API Endpoints ---

// SIGNUP Endpoint
app.post('/api/signup', async (req, res) => {
    try {
        const { name, username, password, role, roleType, location } = req.body;

        if (!name || !username || !password || !role || !roleType) {
            return res.status(400).json({ message: 'All fields are required.' });
        }

        const usersCollection = db.collection('users');
        const existingUser = await usersCollection.findOne({ username, role });

        if (existingUser) {
            return res.status(409).json({ message: 'Username already exists for this role. Please login.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = {
            name,
            username,
            password: hashedPassword,
            role,
            roleType,
            location: location || null
        };

        await usersCollection.insertOne(newUser);
        
        // Don't send the password back
        const userToReturn = { ...newUser };
        delete userToReturn.password;

        res.status(201).json({ message: 'User created successfully!', user: userToReturn });

    } catch (error) {
        console.error('[ERROR] Signup failed:', error);
        res.status(500).json({ message: 'Server error during signup.' });
    }
});


// LOGIN Endpoint
app.post('/api/login', async (req, res) => {
    try {
        const { username, password, role } = req.body;

        if (!username || !password || !role) {
            return res.status(400).json({ message: 'Username, password, and role are required.' });
        }
        
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ username, role });

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials. User not found for this role.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials. Password does not match.' });
        }

        // Don't send the password back
        const userToReturn = { ...user };
        delete userToReturn.password;

        res.status(200).json({ message: 'Login successful!', user: userToReturn });

    } catch (error) {
        console.error('[ERROR] Login failed:', error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});


// --- Email Fetching Logic (Existing) ---
function getEmails() {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: process.env.IMAP_USER,
            password: process.env.IMAP_PASSWORD,
            host: 'imap.gmail.com',
            port: 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false }
        });

        imap.once('ready', () => {
            imap.openBox('INBOX', true, (err, box) => {
                if (err) return reject(err);
                imap.search(['ALL'], (err, results) => {
                    if (err) return reject(err);
                    if (!results || results.length === 0) {
                        imap.end();
                        return resolve([]);
                    }
                    const fetch = imap.fetch(results, { bodies: '' });
                    const messagePromises = [];
                    fetch.on('message', (msg) => {
                        const messagePromise = new Promise((resolveMsg, rejectMsg) => {
                            msg.on('body', (stream) => {
                                simpleParser(stream, (err, parsed) => {
                                    if (err) return rejectMsg(err);
                                    resolveMsg({
                                        from: parsed.from ? parsed.from.text : 'Unknown Sender',
                                        subject: parsed.subject || 'No Subject',
                                        body: parsed.text || 'No Body',
                                        date: parsed.date || new Date(),
                                    });
                                });
                            });
                            msg.once('error', rejectMsg);
                        });
                        messagePromises.push(messagePromise);
                    });
                    fetch.once('error', reject);
                    fetch.once('end', () => {
                        Promise.all(messagePromises).then(emails => {
                            imap.end();
                            resolve(emails);
                        }).catch(reject);
                    });
                });
            });
        });

        imap.once('error', reject);
        imap.connect();
    });
}

app.get('/api/emails', async (req, res) => {
    try {
        const emails = await getEmails();
        res.json(emails);
    } catch (error) {
        console.error("[ERROR] API Error:", error.message);
        res.status(500).json({ error: 'Failed to fetch emails.' });
    }
});


// --- Server Start ---
app.listen(port, () => {
    console.log(`Server with auth listening at http://localhost:${port}`);
});
