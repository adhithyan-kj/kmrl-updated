// server.js
// To run this:
// 1. Make sure you have the necessary packages:
//    npm install express node-imap mailparser dotenv cors
// 2. Ensure your .env file is correctly set up with IMAP_USER and a Google App Password.
// 3. Stop the old server (Ctrl+C in the terminal) and run this one: node server.js

import express from 'express';
import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
const port = 3000;

// Use CORS to allow your HTML file to make requests to this server
app.use(cors());

// This function connects to IMAP and fetches emails
function getEmails() {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: process.env.IMAP_USER,
            password: process.env.IMAP_PASSWORD, // IMPORTANT: This must be a Google App Password
            host: 'imap.gmail.com',
            port: 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false }
        });

        imap.once('ready', () => {
            console.log('[LOG] IMAP connection successful. Opening INBOX...');
            imap.openBox('INBOX', true, (err, box) => {
                if (err) {
                    console.error('[ERROR] Error opening INBOX:', err);
                    return reject(err);
                }
                console.log('[LOG] INBOX opened. Searching for all emails...');

                imap.search(['ALL'], (err, results) => {
                    if (err) {
                       console.error('[ERROR] Error searching emails:', err);
                       return reject(err);
                    }
                    if (!results || results.length === 0) {
                        console.log('[LOG] No emails found.');
                        imap.end();
                        return resolve([]);
                    }
                    console.log(`[LOG] Found ${results.length} emails. Fetching content...`);

                    const fetch = imap.fetch(results, { bodies: '' });
                    const messagePromises = []; // Array to hold promises for each message

                    fetch.on('message', (msg) => {
                        // For each message, create a promise that will be resolved once it's parsed.
                        const messagePromise = new Promise((resolveMsg, rejectMsg) => {
                            // The 'body' event gives us the stream we need to parse.
                            msg.on('body', (stream) => {
                                // Pass the stream directly to simpleParser.
                                simpleParser(stream, (err, parsed) => {
                                    if (err) {
                                        return rejectMsg(err);
                                    }
                                    resolveMsg({
                                        from: parsed.from ? parsed.from.text : 'Unknown Sender',
                                        subject: parsed.subject || 'No Subject',
                                        body: parsed.text || 'No Body',
                                        date: parsed.date || new Date(),
                                    });
                                });
                            });
                             // Handle potential errors on the message object itself.
                            msg.once('error', (err) => {
                                rejectMsg(err);
                            });
                        });
                        messagePromises.push(messagePromise);
                    });

                    fetch.once('error', (err) => {
                        console.log('[ERROR] Fetch error: ' + err);
                        reject(err);
                    });

                    fetch.once('end', () => {
                        console.log('[LOG] Finished fetching all messages. Parsing...');
                        // Wait for all the individual message promises to resolve.
                        Promise.all(messagePromises)
                            .then(emails => {
                                console.log('[LOG] All emails parsed successfully.');
                                imap.end();
                                resolve(emails);
                            })
                            .catch(err => {
                                console.error('[ERROR] Error parsing one or more emails:', err);
                                imap.end();
                                reject(err);
                            });
                    });
                });
            });
        });

        imap.once('error', err => {
            console.error('[ERROR] IMAP connection error:', err);
            reject(err);
        });
        
        imap.once('end', () => {
            console.log('[LOG] IMAP connection ended.');
        });

        console.log('[LOG] Attempting to connect to IMAP server...');
        imap.connect();
    });
}

// API endpoint that the frontend will call
app.get('/api/emails', async (req, res) => {
    try {
        const emails = await getEmails();
        console.log(`[LOG] Sending ${emails.length} emails to the client.`);
        res.json(emails);
    } catch (error) {
        console.error("[ERROR] API Error:", error.message);
        res.status(500).json({ error: 'Failed to fetch emails due to a server error.' });
    }
});

app.listen(port, () => {
    console.log(`Email server listening at http://localhost:${port}`);
});

