require("dotenv").config();
const OpenAI = require('openai');
const express = require('express');
const { OPENAI_API_KEY, ASSISTANT_ID, SERPAPI_KEY } = process.env;

// + Addition for function calling
const { getJson } = require("serpapi");

// Setup Express
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// Set up OpenAI Client
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

// Assistant can be created via API or UI
const assistantId = ASSISTANT_ID;
let pollingInterval;

// + Addition for function calling
// Remember you can declare function on assistant API (during creation) 
//      or directly at GUI

async function getSearchResult(query) {
    console.log('------- CALLING AN EXTERNAL API ----------')
    const json = await getJson({
        engine: "google",
        api_key: SERPAPI_KEY,
        q: query,
        location: "Austin, Texas",
    });

    return json["organic_results"];
}

// Set up a Thread
async function createThread() {
    console.log('Creating a new thread...');
    const thread = await openai.beta.threads.create();
    return thread;
}

async function addMessage(threadId, message) {
    console.log('Adding a new message to thread: ' + threadId);
    const response = await openai.beta.threads.messages.create(
        threadId,
        {
            role: "user",
            content: message
        }
    );
    return response;
}

async function runAssistant(threadId) {
    console.log('Running assistant for thread: ' + threadId)
    const response = await openai.beta.threads.runs.create(
        threadId,
        { 
          assistant_id: assistantId
          // Make sure to not overwrite the original instruction, unless you want to
        }
      );

    return response;
}

async function checkingStatus(res, threadId, runId) {
    const runObject = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
    );

    const status = runObject.status;
    console.log('Current status: ' + status);
    
    if(status == 'completed') {
        clearInterval(pollingInterval);

        const messagesList = await openai.beta.threads.messages.list(threadId);
        let messages = []
        
        messagesList.body.data.forEach(message => {
            messages.push(message.content);
        });

        res.json({ messages });
    }

    // + Addition for function calling
    else if(status === 'requires_action') {
        console.log('requires_action.. looking for a function')

        if(runObject.required_action.type === 'submit_tool_outputs') {
            console.log('submit tool outputs ... ')
            const tool_calls = await runObject.required_action.submit_tool_outputs.tool_calls
            // Can be choose with conditional, if you have multiple function
            const parsedArgs = JSON.parse(tool_calls[0].function.arguments);
            console.log('Query to search for: ' + parsedArgs.query)

            const apiResponse = await getSearchResult(parsedArgs.query)
            
            const run = await openai.beta.threads.runs.submitToolOutputs(
                threadId,
                runId,
                {
                  tool_outputs: [
                    {
                      tool_call_id: tool_calls[0].id,
                        output: JSON.stringify(apiResponse)
                    },
                  ],
                }
            )

            console.log('Run after submit tool outputs: ' + run.status)
        }
    }
}

//=========================================================
//============== ROUTE SERVER =============================
//=========================================================

// Open a new thread
app.get('/thread', (req, res) => {
    createThread().then(thread => {
        res.json({ threadId: thread.id });
    });
})

app.post('/message', (req, res) => {
    const { message, threadId } = req.body;
    addMessage(threadId, message).then(message => {
        // res.json({ messageId: message.id });

        // Run the assistant
        runAssistant(threadId).then(run => {
            const runId = run.id;           
            
            // Check the status
            pollingInterval = setInterval(() => {
                checkingStatus(res, threadId, runId);
            }, 5000);
        });
    });
  });

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});