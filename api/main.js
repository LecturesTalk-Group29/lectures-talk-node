const express = require('express');
const app = express();
const axios = require('axios');
require('dotenv').config(); // Load environment variables from .env file.
const { MongoClient } = require('mongodb');

// Replace with your OpenAI key and MongoDB URL.
const openai_key = process.env.OPENAI_KEY;
const mongoURL = process.env.MONGO_URL;
app.use(express.json());
// Define your functions here (getEmbedding, createEmbedding, findSimilarDocuments, uploadDoc).
async function getEmbedding(query) {

    console.log("query: ", query)

    // Define the OpenAI API url and key.
    const url = 'https://api.openai.com/v1/embeddings';
    const openai_key = process.env.OPENAI_KEY;
    
    // Call OpenAI API to get the embeddings.
    let response = await axios.post(url, {
        input: query,
        model: "text-embedding-ada-002"
    }, {
        headers: {
            'Authorization': `Bearer ${openai_key}`,
            'Content-Type': 'application/json'
        }
    });
    
    if(response.status === 200) {
        const [{embedding}] = response.data?.data
        //console.log('embedding', embedding)
        return embedding
    } else {
        throw new Error(`Failed to get embedding. Status code: ${response.status}`);
    }
}


async function createEmbedding(text){ //function to take in any text and sends it to the openai embedding ada 002 model to return embeddings
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
    const [{embedding}] = response.data?.data
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
                score: {$meta: 'searchscore'}
                },
            },
        ]).toArray()

        return documents
        
    } finally {
        await client.close();
    }
}

async function uploadDoc(docTextI){
    const url = process.env.MONGO_URL; // Replace with your MongoDB url.
    const client = new MongoClient(url);
    await client.connect();
    console.log("connected")
    const db = client.db('lectures_talk'); // Replace with your database name.
    const collection = db.collection('trigger_test'); // Replace with your collection name.
    const embeddedData = await createEmbedding(docTextI)
    console.log("created embedding")
    const doc = {
        title:"test doc",
        text: docTextI,
        embedding: [{embeddedData}]
    }
    const result = await collection.insertOne(doc)
    await client.close()
    console.log("inserted")
}



// Define an API endpoint to get embeddings.
app.get('/api/getEmbedding', async (req, res) => {
    const query = req.body.query; // Query parameter from the request.
    try {
        const embedding = await getEmbedding(query);
        res.json({ embedding });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get embedding' });
    }
});

// Define an API endpoint to find similar documents.
app.get('/api/findSimilarDocuments', async (req, res) => {
    const query = req.body.text;
    const embedding = await createEmbedding(query); // Query parameter from the request.
    console.log("embedding created", embedding)
    try {
        const documents = await findSimilarDocuments(embedding);
        
        res.json({ documents });
    } catch (error) {
        res.status(500).json({ error: 'Failed to find similar documents' });
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
    console.log(`Server is running on port ${port}`);
});
