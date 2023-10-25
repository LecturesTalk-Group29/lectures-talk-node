const express = require('express');
const app = express();
const axios = require('axios');
const cors = require('cors');
require('dotenv').config(); // Load environment variables from .env file.
const { MongoClient } = require('mongodb');
const { ObjectId } = require('mongodb');


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


async function summarizeGPT(query) {
    try {
      if (!query) {
        throw new Error('Message is required in the request body');
      }
      const instructions = `
    I am going to be feeding you some blocks of text from a lecture in the format of: start time : text, 
    summarize all of it. Use passive voice, respond with summary only, no preamble or postambl
`;
      const gptPrompt =instructions  + query;
  
      const apiKey = process.env.OPENAI_KEY;
      const endpoint = 'https://api.openai.com/v1/chat/completions';
  
      const response = await axios.post(endpoint, {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: gptPrompt }],
        temperature: 0.9,
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
  
      const content = response.data.choices[0].message.content;
      return content;
    } catch (error) {
      console.error('Error:', error);
      throw error;
    }
  }

  function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }


  let summaryIdCounter = 0;

  function createSummaryWithTimestamps(firstTimestamp, lastTimestamp, text) {
    const id = summaryIdCounter;
    summaryIdCounter++;
    return {
      id: id,
      start: firstTimestamp,
      end: lastTimestamp,
      text: text,
    };
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

//Endpoint to summarize doc
app.get('/api/summarize/:docID', async (req, res) => {
    let client;
    try {
      const url = process.env.MONGO_URL;
      const collectionName = 'videos';
      const documentId = req.params.docID;
  
      const objectId = new ObjectId(documentId);
  
      client = new MongoClient(url);
      await client.connect();
      console.log('Connected');
  
      const db = client.db('lectures_talk');
      const collection = db.collection(collectionName);
  
      const document = await collection.findOne({ _id: objectId });
  
      if (!document) {
        throw new Error('Document not found');
      }
      console.log('Document retrieved');
  
      const segments = document.segments;
      const summaries = [];
  
      let block = [];
      let firstTimestamp = null; // Store the first timestamp in the block
  
      for (const segment of segments) {
        const { text, start } = segment;
  
        // If the block is empty, set the first timestamp
        if (block.length === 0) {
          firstTimestamp = start;
        }
  
        block.push(`${start}: ${text}`);
  
        if (block.length >= 40) {
          const summaryText = await summarizeGPT(block.join('\n'));
          const lastTimestamp = segment.start; // Store the last timestamp in the block
          summaries.push(createSummaryWithTimestamps(firstTimestamp, lastTimestamp, summaryText));
          console.log(summaries)
          block = []; // Reset the block
        }
      }
  
      // If there are remaining segments in the block, summarize them
      if (block.length > 0) {
        const summaryText = await summarizeGPT(block.join('\n'));
        const lastTimestamp = segments[segments.length - 1].start;
        summaries.push(createSummaryWithTimestamps(firstTimestamp, lastTimestamp, summaryText));
      }

/*  commeted out for now because i dont want to mess with the database, this will update the document with the fields "lectureSegments"
      await collection.updateOne(
        { _id: objectId },
        {
          $set: {
            lectureSegments: summaries,
          },
        }
      );
      */
      res.json({ summaries });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'An error occurred' });
    } finally {
      if (client) {
        client.close();
      }
    }
  });
  

// Start the Express server.
const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
