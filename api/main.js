const express = require('express');
const app = express();
const axios = require('axios');
const cors = require('cors');
require('dotenv').config(); // Load environment variables from .env file.
const { MongoClient } = require('mongodb');


app.use(express.json());
app.use(cors());


async function createEmbedding(text) { //function to take in any text and sends it to the openai embedding ada 002 model to return embeddings
    const url = 'https://api.openai.com/v1/embeddings';
    const openai_key = process.env.OPENAI_KEY; // Replace with your OpenAI key.

    // Call OpenAI API to get the embeddings.
    let response = await axios.post(url, {
        input: text,
        model: "text-embedding-ada-002"
    }, {
        headers: {
            'Authorization': `Bearer ${openai_key}`,
            'Content-Type': 'application/json'
        }
    });
    const [{ embedding }] = response.data?.data
    console.log('embedding', embedding)
    return embedding

}

async function findSimilarDocuments(embedding) {
    const url = process.env.MONGO_URL;
    const client = new MongoClient(url);

    try {
        await client.connect();

        const db = client.db('lectures_talk');
        const collection = db.collection('trigger_test');

        // Query for similar documents.
        const documents = await collection.aggregate([
            {
                $search: {
                    knnBeta: {
                        vector: embedding,
                        //this is the path to the embedding field in mongo document upload
                        //https://www.mongodb.com/docs/atlas/atlas-search/field-types/knn-vector/
                        path: 'embeddedData ',
                        k: 5,
                    },
                },
            },
            {
                $project: {
                    description: 1, // i dont know if i can change this, but it was set to 1 in the tutorial docs
                    score: { $meta: 'searchscore' }
                },
            },
        ]).toArray()

        return documents[0] // will fix later, just a lazy way to get highest metascore for the time being

    } catch {
        const returnNoDoc = "No Context given"
        return returnNoDoc
    } finally {
        await client.close();
    }
}

async function uploadDoc(docTextI) {
    const url = process.env.MONGO_URL; // Replace with your MongoDB url.
    const client = new MongoClient(url);
    await client.connect();
    console.log("connected")
    const db = client.db('lectures_talk'); // Replace with your database name.
    const collection = db.collection('trigger_test'); // Replace with your collection name.
    const embeddedData = await createEmbedding(docTextI)
    console.log("created embedding")
    const doc = {
        title: "test doc",
        text: docTextI,
        embedding: [{ embeddedData }]
    }
    const result = await collection.insertOne(doc)
    await client.close()
    console.log("inserted")
}

//Endpoint that gets User's text and returns context-aware AI responce
//Accepts: {"query": "Some chat question"}
//Returns: {"content": "Some AI answer"}
app.post('/api/queryGPT', async (req, res) => {
    const { query } = req.body;
    const messageEmbeddings = await createEmbedding(query)
    const similarDocuments = await findSimilarDocuments(messageEmbeddings)
    const releveantInfo = similarDocuments

    const gptPrompt = "Based on " + releveantInfo + " and your knowledge, " + query;
    if (!query) {
        return res.status(400).json({ error: 'Message is required in the request body' });
    }

    try {
        const apiKey = process.env.OPENAI_KEY;
        const endpoint = 'https://api.openai.com/v1/chat/completions';

        const response = await axios.post(endpoint, {
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: gptPrompt }],
            temperature: 0.7,
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        const content = response.data.choices[0].message.content;
        res.json({ content });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/chatTestEcho', (req, res) => {
    const { query } = req.body; // Extract the query property from the incoming JSON

    // Check if query property exists
    if (typeof query !== 'undefined') {
        setTimeout(() => {
            res.json({ content: "Meaty human said: " + query });
        }, 1500);
    } else {
        res.status(400).send('Bad Request: Missing query property in request body');
    }
});

// Define an API endpoint to upload a document.
app.post('/api/uploadDoc', async (req, res) => {
    const docText = req.body.text; // Text from the request body.
    console.log(docText)
    try {
        await uploadDoc(docText);
        res.json({ message: 'Document uploaded successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to upload document' });
    }
});

// Start the Express server.
const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
