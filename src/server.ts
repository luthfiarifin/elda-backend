import express, { Request, Response, Application, NextFunction, RequestHandler } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import ContactModel, { IContact } from './models/Contact';
import TaskModel, { ITask } from './models/Task';

// --- Load Environment Variables ---
dotenv.config();

// --- Configuration and Validation ---
function getEnvVariable(key: string): string {
    const value = process.env[key];
    if (!value) {
        console.error(`CRITICAL: Environment variable ${key} is not defined.`);
        process.exit(1);
    }
    return value;
}

const PORT: number = parseInt(process.env.PORT || '3000', 10);
const MONGODB_URI: string = getEnvVariable('MONGODB_URI');
const GEMINI_API_KEY: string = getEnvVariable('GEMINI_API_KEY');

// --- Type Definitions ---
interface GeminiEntities { name?: string | null; phoneNumber?: string | null; relationship?: string | null; description?: string | null; time?: string | null; }
interface GeminiResponse { intent: 'add_contact' | 'add_task' | 'get_contacts' | 'get_tasks' | 'unknown'; entities: GeminiEntities; targetCollection: 'contacts' | 'tasks' | null; error?: string; }
interface ProcessSpeechRequestBody { text?: string; }

// --- Initialize Gemini ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ],
});

// --- Connect to MongoDB ---
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Successfully connected to MongoDB'))
    .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

// --- Express App Setup ---
const app: Application = express();
app.use(cors());
app.use(express.json()); // Make sure middleware is used *before* routes that need it

// --- Helper Functions (processTextWithGemini, extractJsonFromString - keep as before) ---
function extractJsonFromString(text: string): GeminiResponse | null { /* ... implementation from previous step ... */
    // Try finding JSON within potential markdown fences or plain text
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```|({[\s\S]*})/);
    if (jsonMatch) {
        const jsonString = jsonMatch[1] || jsonMatch[2]; // Get content from group 1 or 2
        try {
            const parsed = JSON.parse(jsonString);
            // Basic validation of the parsed object structure
            if (parsed && typeof parsed === 'object' && parsed.intent && parsed.entities && typeof parsed.targetCollection !== 'undefined') {
                // Perform more specific type checks if necessary here
                return parsed as GeminiResponse; // Assume structure matches for now
            }
        } catch (e) {
            console.error("Failed to parse JSON from Gemini response:", e);
            return null;
        }
    }
    console.error("Could not find valid JSON block in Gemini response.");
    return null;
}

async function processTextWithGemini(text: string): Promise<GeminiResponse> { /* ... implementation from previous step ... */
    const prompt = `
You are an AI assistant helping elderly users manage their contacts and tasks based on their speech.
Analyze the following user request: "${text}"

Determine the user's primary intent and extract the relevant entities.

Possible Intents:
- add_contact: User wants to save a new contact.
- add_task: User wants to save a new task or reminder.
- get_contacts: User wants to retrieve saved contacts.
- get_tasks: User wants to retrieve saved tasks.
- unknown: The user's request is unclear or unrelated.

Entities to Extract:
- For 'add_contact': name (string), phoneNumber (string), relationship (string, optional)
- For 'add_task': description (string), time (string, optional)
- For 'get_contacts': name (string, optional, if searching for a specific contact)
- For 'get_tasks': time (string, optional, e.g., "today", "morning"), description (string, optional, keywords)

Based on the intent, determine the target data collection: 'contacts' or 'tasks'.

Respond ONLY with a JSON object containing:
1.  'intent': One of the possible intents listed above.
2.  'entities': An object containing the extracted entities (use null if an entity is not found).
3.  'targetCollection': Either 'contacts', 'tasks', or null if the intent is 'unknown'.

Example Input: "Please add my son John Doe to my contacts, his number is 555-111-2222"
Example Output:
{
  "intent": "add_contact",
  "entities": {
    "name": "John Doe",
    "phoneNumber": "555-111-2222",
    "relationship": "son"
  },
  "targetCollection": "contacts"
}

Now, analyze the user request: "${text}"
Respond only with the JSON object. No other text before or after.
    `;

    try {
        console.log(`Sending request to Gemini for text: "${text}"`);
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;

        // Check for safety blocks or other issues before getting text
        if (!response || response.promptFeedback?.blockReason) {
            console.error("Gemini request blocked. Reason:", response.promptFeedback?.blockReason);
            return { intent: 'unknown', entities: {}, targetCollection: null, error: `Content blocked due to ${response.promptFeedback?.blockReason}` };
        }

        const responseText = response.text();
        console.log("Gemini Raw Response Text:", responseText);

        const parsedJson = extractJsonFromString(responseText);

        if (!parsedJson) {
            throw new Error("Failed to extract or parse valid JSON from Gemini response.");
        }

        console.log("Gemini Parsed Response:", parsedJson);
        return parsedJson;

    } catch (error: unknown) { // Catch as unknown for type safety
        console.error("Error interacting with Gemini API:", error);
        let errorMessage = "An unknown error occurred during Gemini processing.";
        if (error instanceof Error) {
            errorMessage = `Gemini Processing Error: ${error.message}`;
        }
        // Return a structured error response
        return {
            intent: 'unknown',
            entities: {},
            targetCollection: null,
            error: errorMessage
        };
    }
}


// --- API Routes ---
// Ensure this is correctly using app.post with the path and the async handler
app.post('/api/process-speech', (async (req: Request<{}, {}, ProcessSpeechRequestBody>, res: Response, next: NextFunction) => {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ message: 'Valid text input is required in the request body' });
    }

    try {
        const { intent, entities, targetCollection, error: geminiError } = await processTextWithGemini(text);

        if (geminiError || intent === 'unknown') {
            console.error("Gemini processing issue:", geminiError || "Unknown intent received");
            const userMessage = geminiError ? "Sorry, I had trouble understanding that right now." : "I'm sorry, I didn't quite understand your request.";
            const statusCode = geminiError ? 500 : 400;
            return res.status(statusCode).json({ message: userMessage, details: geminiError || 'Unknown intent' });
        }

        console.log(`Processing Intent: ${intent}, Target: ${targetCollection}, Entities:`, entities);

        let responseMessage: string = "Something went wrong while processing your request.";

        // Validate Intent/Collection Mismatch (Warning only)
        if (((intent === 'add_contact' || intent === 'get_contacts') && targetCollection !== 'contacts') ||
            ((intent === 'add_task' || intent === 'get_tasks') && targetCollection !== 'tasks')) {
            console.warn(`Intent/Collection mismatch: Intent is ${intent}, but collection is ${targetCollection}`);
        }

        // Database interactions wrapped in try-catch
        try {
            switch (intent) {
                case 'add_contact':
                    if (entities.name && entities.phoneNumber) {
                        const newContact = new ContactModel({ name: entities.name, phoneNumber: entities.phoneNumber, relationship: entities.relationship });
                        await newContact.save();
                        responseMessage = `OK. I've added ${entities.name} to your contacts.`;
                    } else {
                        responseMessage = "I understood you want to add a contact, but I couldn't get the required name or phone number.";
                        return res.status(400).json({ message: responseMessage });
                    }
                    break;
                case 'add_task':
                    if (entities.description) {
                        const newTask = new TaskModel({ description: entities.description, time: entities.time || undefined });
                        await newTask.save();
                        responseMessage = `OK. I've added the task: ${entities.description}.`;
                    } else {
                        responseMessage = "I understood you want to add a task, but I couldn't get the description.";
                        return res.status(400).json({ message: responseMessage });
                    }
                    break;
                case 'get_tasks':
                    {
                        const query: mongoose.FilterQuery<ITask> = { isCompleted: false };
                        if (entities.time) { query.time = new RegExp(entities.time, 'i'); }
                        if (entities.description) { query.description = new RegExp(entities.description.split(' ').join('|'), 'i'); }
                        const tasks = await TaskModel.find(query).sort({ createdAt: -1 });
                        responseMessage = tasks.length > 0
                            ? `Here are your current tasks: ${tasks.map(t => `${t.description}${t.time ? ` at ${t.time}` : ''}`).join('. ')}`
                            : "You have no pending tasks matching that description.";
                    }
                    break;
                case 'get_contacts':
                    {
                        const query: mongoose.FilterQuery<IContact> = {};
                        if (entities.name) { query.name = new RegExp(entities.name, 'i'); }
                        const contacts = await ContactModel.find(query);
                        responseMessage = contacts.length > 0
                            ? `Here are the contacts I found: ${contacts.map(c => `${c.name}, phone ${c.phoneNumber}${c.relationship ? ` (${c.relationship})` : ''}`).join('. ')}`
                            : entities.name ? `I couldn't find a contact named ${entities.name}.` : "You don't have any contacts saved yet.";
                    }
                    break;
            }
            res.status(200).json({ message: responseMessage, intent: intent, entities: entities });

        } catch (dbError: unknown) {
            console.error("Database operation failed:", dbError);
            next(dbError); // Forward DB errors to central handler
        }

    } catch (error: unknown) {
        console.error('Unexpected error in /api/process-speech endpoint:', error);
        next(error); // Forward other unexpected errors
    }
}) as RequestHandler); // <--- Make sure this parenthesis closes the app.post call

// --- Central Error Handling Middleware ---
// IMPORTANT: This MUST be defined *after* all your routes
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("Unhandled Error:", err.stack);
    const status = (err as any).status || 500;
    const message = process.env.NODE_ENV === 'production'
        ? 'An internal server error occurred.'
        : `Internal Server Error: ${err.message}`; // Provide more detail in dev

    res.status(status).json({ message: message });
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});