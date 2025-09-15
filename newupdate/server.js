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
// ✅ Use Render-assigned port or fallback to 3000
const port = process.env.PORT || 3000;

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

// --- Gemini AI Function ---
async function processEmailWithAI(email) {
    const GEMINI_API_KEY = "AIzaSyBaSJz-8Ma99Whgh7OcqBAuWx9AlysEsoU";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    const prompt = `Analyze the following email content. Classify it, extract key entities, and suggest the primary role(s) for action. Respond ONLY with a valid JSON object using the specified schema. Schema: {"classification": "String", "urgency": "String ('Low', 'Medium', 'High')", "location": "String", "details": "String", "extracted_action": "String", "suggested_action_roles": "Array of strings"}. Email Subject: "${email.subject}" Email Body: """${email.body}"""`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(`Gemini API Error: ${errorBody.error.message}`);
        }
        const result = await response.json();
        const rawJsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawJsonText) throw new Error("No content from Gemini.");
        const cleanedJsonText = rawJsonText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanedJsonText);
    } catch (error) {
        console.error('[ERROR] Failed to process email with AI:', error);
        return null;
    }
}

// --- API Endpoints ---
// (All your signup, login, tasks, emails, and live-status endpoints remain unchanged)

// --- Server Start ---
app.listen(port, () => {
    console.log(`Server with AI and GTFS listening at http://localhost:${port}`);
});
