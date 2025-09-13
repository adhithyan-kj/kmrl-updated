// server.js
import express from 'express';
import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import dotenv from 'dotenv';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';
import fetch from 'node-fetch';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

dotenv.config();

const app = express();
const port = 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- GTFS Data Loading ---
let gtfsData = {};

function loadGTFSData() {
    console.log('[LOG] Loading GTFS schedule data...');
    try {
        const stops = parse(fs.readFileSync('./data/stops.txt', 'utf8'), { columns: true, skip_empty_lines: true });
        const stopTimes = parse(fs.readFileSync('./data/stop_times.txt', 'utf8'), { columns: true, skip_empty_lines: true });
        const trips = parse(fs.readFileSync('./data/trips.txt', 'utf8'), { columns: true, skip_empty_lines: true });
        const calendar = parse(fs.readFileSync('./data/calendar.txt', 'utf8'), { columns: true, skip_empty_lines: true });
        const routes = parse(fs.readFileSync('./data/routes.txt', 'utf8'), { columns: true, skip_empty_lines: true });

        gtfsData = {
            stops: new Map(stops.map(s => [s.stop_id, s])),
            stopTimes: stopTimes,
            trips: new Map(trips.map(t => [t.trip_id, t])),
            calendar: calendar,
            routes: new Map(routes.map(r => [r.route_id, r]))
        };
        console.log('[LOG] GTFS data loaded successfully.');
    } catch (error) {
        console.error('[ERROR] Failed to load GTFS data:', error);
        // Exit if schedule data is critical and unavailable
        process.exit(1);
    }
}


// --- MongoDB Connection ---
let db;
const client = new MongoClient(process.env.MONGO_URI);

async function connectToMongo() {
    try {
        await client.connect();
        console.log('[LOG] Successfully connected to MongoDB.');
        db = client.db('metromithra');
    } catch (err) {
        console.error('[ERROR] Failed to connect to MongoDB:', err);
        process.exit(1);
    }
}

// --- Run startup functions ---
loadGTFSData();
connectToMongo();

// --- Gemini AI Function (No changes) ---
async function processEmailWithAI(email) {
    const GEMINI_API_KEY = "AIzaSyBaSJz-8Ma99Whgh7OcqBAuWx9AlysEsoU";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    const prompt = `Analyze the following email content. Classify it, extract key entities, and suggest the primary role(s) for action. Respond ONLY with a valid JSON object using the specified schema. Schema: {"classification": "String", "urgency": "String ('Low', 'Medium', 'High')", "location": "String", "details": "String", "extracted_action": "String", "suggested_action_roles": "Array of strings"}. Email Subject: "${email.subject}" Email Body: """${email.body}"""`;
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        if (!response.ok) { const errorBody = await response.json(); throw new Error(`Gemini API Error: ${errorBody.error.message}`); }
        const result = await response.json();
        const rawJsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawJsonText) throw new Error("No content from Gemini.");
        const cleanedJsonText = rawJsonText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanedJsonText);
    } catch (error) { console.error('[ERROR] Failed to process email with AI:', error); return null; }
}


// --- API Endpoints ---

// Auth endpoints (No changes)
app.post('/api/signup', async (req, res) => { try { const { name, username, password, role, roleType, location } = req.body; if (!name || !username || !password || !role || !roleType) return res.status(400).json({ message: 'All fields are required.' }); const usersCollection = db.collection('users'); const existingUser = await usersCollection.findOne({ username, role }); if (existingUser) return res.status(409).json({ message: 'Username already exists for this role. Please login.' }); const hashedPassword = await bcrypt.hash(password, 10); const newUser = { name, username, password: hashedPassword, role, roleType, location: location || null }; await usersCollection.insertOne(newUser); const userToReturn = { ...newUser }; delete userToReturn.password; res.status(201).json({ message: 'User created successfully!', user: userToReturn }); } catch (error) { console.error('[ERROR] Signup failed:', error); res.status(500).json({ message: 'Server error during signup.' }); } });
app.post('/api/login', async (req, res) => { try { const { username, password, role } = req.body; if (!username || !password || !role) return res.status(400).json({ message: 'Username, password, and role are required.' }); const usersCollection = db.collection('users'); const user = await usersCollection.findOne({ username, role }); if (!user) return res.status(401).json({ message: 'Invalid credentials. User not found for this role.' }); const isMatch = await bcrypt.compare(password, user.password); if (!isMatch) return res.status(401).json({ message: 'Invalid credentials. Password does not match.' }); const userToReturn = { ...user }; delete userToReturn.password; res.status(200).json({ message: 'Login successful!', user: userToReturn }); } catch (error) { console.error('[ERROR] Login failed:', error); res.status(500).json({ message: 'Server error during login.' }); } });

// Tasks endpoint (No changes)
app.get('/api/tasks', async (req, res) => { const { role } = req.query; if (!role) { return res.status(400).json({ message: 'Role query parameter is required.' }); } try { const tasksCollection = db.collection('tasks'); const userTasks = await tasksCollection.find({ assigned_to_role: role }).sort({ createdAt: -1 }).toArray(); res.status(200).json(userTasks); } catch (error) { console.error('[ERROR] Failed to fetch tasks:', error); res.status(500).json({ message: 'Server error while fetching tasks.' }); } });

// Email fetching and processing (No changes)
function getRawEmailsFromImap() { return new Promise((resolve, reject) => { const imap = new Imap({ user: process.env.IMAP_USER, password: process.env.IMAP_PASSWORD, host: 'imap.gmail.com', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false } }); imap.once('ready', () => { imap.openBox('INBOX', true, (err, box) => { if (err) return reject(err); imap.search(['ALL'], (err, results) => { if (err || !results || results.length === 0) { imap.end(); return resolve([]); } const fetch = imap.fetch(results, { bodies: '' }); const messagePromises = []; fetch.on('message', (msg) => { const messagePromise = new Promise((resolveMsg) => { msg.on('body', (stream) => { simpleParser(stream, (err, parsed) => { if (err) return resolveMsg(null); resolveMsg({ from: parsed.from ? parsed.from.text : 'Unknown', subject: parsed.subject || 'No Subject', body: parsed.text || 'No Body', date: parsed.date || new Date(), }); }); }); }); messagePromises.push(messagePromise); }); fetch.once('error', reject); fetch.once('end', () => { Promise.all(messagePromises).then(emails => { imap.end(); resolve(emails.filter(e => e !== null)); }).catch(reject); }); }); }); }); imap.once('error', reject); imap.connect(); }); }
app.get('/api/emails', async (req, res) => { try { const rawEmails = await getRawEmailsFromImap(); const documentsCollection = db.collection('processed_documents'); const tasksCollection = db.collection('tasks'); for (const email of rawEmails) { const existingDoc = await documentsCollection.findOne({ "original_email.subject": email.subject, "original_email.date": email.date }); if (existingDoc) { continue; } const aiData = await processEmailWithAI(email); if (aiData) { const newDocument = { original_email: email, ai_analysis: aiData, createdAt: new Date() }; const insertResult = await documentsCollection.insertOne(newDocument); const newDocId = insertResult.insertedId; if (aiData.suggested_action_roles && aiData.suggested_action_roles.length > 0) { for (const role of aiData.suggested_action_roles) { const newTask = { assigned_to_role: role, title: aiData.classification || email.subject, description: aiData.extracted_action || aiData.details, status: "Pending", source_document_id: newDocId, createdAt: new Date() }; await tasksCollection.insertOne(newTask); } } } } const allProcessedDocs = await documentsCollection.find().sort({ createdAt: -1 }).toArray(); res.json(allProcessedDocs); } catch (error) { console.error("[ERROR] API Error in /api/emails:", error.message); res.status(500).json({ error: 'Failed to fetch and process emails.' }); } });


// --- NEW Live Metro Status Endpoint ---
app.get('/api/live-status', (req, res) => {
    try {
        // --- Determine active service day ---
        const now = new Date();
        // NOTE: Simulating a busy time for demonstration purposes. Replace this with 'now' for production.
        const simulatedNow = new Date(now);
        simulatedNow.setHours(10, 15, 0); // Simulate 10:15 AM
        
        const dayIndex = simulatedNow.getDay(); // Sunday = 0, Monday = 1, ...
        const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const currentDay = dayMap[dayIndex];

        const activeService = gtfsData.calendar.find(c => c[currentDay] === '1');
        if (!activeService) {
            return res.json([]); // No service today
        }
        const activeServiceId = activeService.service_id;

        // --- Get all trips for the active service ---
        const activeTrips = [];
        gtfsData.trips.forEach((trip, tripId) => {
            if (trip.service_id === activeServiceId) {
                const stopTimesForTrip = gtfsData.stopTimes.filter(st => st.trip_id === tripId);
                if (stopTimesForTrip.length > 0) {
                    activeTrips.push({
                        tripId: tripId,
                        directionId: trip.direction_id,
                        stopTimes: stopTimesForTrip.sort((a, b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence))
                    });
                }
            }
        });
        
        // --- Calculate status for each active trip ---
        const currentTimeStr = simulatedNow.toTimeString().slice(0, 8);
        const liveStatuses = [];

        for (const trip of activeTrips) {
            const firstStopTime = trip.stopTimes[0];
            const lastStopTime = trip.stopTimes[trip.stopTimes.length - 1];

            if (currentTimeStr < firstStopTime.departure_time || currentTimeStr > lastStopTime.arrival_time) {
                continue; // Trip is not currently running
            }

            let status = 'In Transit';
            let lastStation = null, nextStation = null;
            let progress = 0;

            for (let i = 0; i < trip.stopTimes.length; i++) {
                const currentStop = trip.stopTimes[i];
                if (currentTimeStr >= currentStop.arrival_time && currentTimeStr <= currentStop.departure_time) {
                    status = 'At Station';
                    lastStation = i > 0 ? trip.stopTimes[i - 1] : null;
                    nextStation = currentStop;
                    break;
                }
                if (currentTimeStr < currentStop.arrival_time) {
                    lastStation = i > 0 ? trip.stopTimes[i - 1] : firstStopTime;
                    nextStation = currentStop;
                    break;
                }
            }
            
            if (nextStation) {
                progress = (parseInt(nextStation.stop_sequence) - 1) / (trip.stopTimes.length - 1) * 100;
            }

            const fromStation = gtfsData.stops.get(firstStopTime.stop_id);
            const toStation = gtfsData.stops.get(lastStopTime.stop_id);

            liveStatuses.push({
                tripId: trip.tripId,
                direction: `Towards ${toStation.stop_name}`,
                status: status,
                lastStation: lastStation ? { name: gtfsData.stops.get(lastStation.stop_id).stop_name, time: lastStation.departure_time } : {name: "Start of Line"},
                nextStation: nextStation ? { name: gtfsData.stops.get(nextStation.stop_id).stop_name, time: nextStation.arrival_time } : {name: "End of Line"},
                progress: Math.round(progress),
                totalStops: trip.stopTimes.length
            });
        }
        
        res.json(liveStatuses);

    } catch (error) {
        console.error("[ERROR] API Error in /api/live-status:", error);
        res.status(500).json({ error: 'Failed to calculate live train status.' });
    }
});


// --- Server Start ---
app.listen(port, () => {
    console.log(`Server with AI and GTFS listening at http://localhost:${port}`);
});