var {Document,
    VectorStoreIndex,
    SimpleDirectoryReader,
    QueryEngineTool,
    FunctionTool,
    OpenAIAgent,
    RouterQueryEngine} = require('llamaindex')
var express = require('express');
var fs = require('node:fs')
const {mkdir, rename, readdir, unlink} = require('node:fs/promises')
var router = express.Router();
var mod = require('dotenv')
const cors = require('cors');
const {formidable} = require('formidable');
const path = require('path');
mod.config()

const topics = {'general': path.join(`${process.cwd()}`,'data')}
const getDirectories = source =>
  fs.readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .forEach(dirent => {
        topics[`${dirent.name}`]= path.join(`${process.cwd()}`,'data', dirent.name)
    })
getDirectories('./data')

// This will be used to generate the agents


async function initializeAction(questionType, directoryPath){
    const documents = await new SimpleDirectoryReader().loadData({directoryPath:directoryPath})
    const index1 = await VectorStoreIndex.fromDocuments(documents)
    return { 
        queryEngine: index1.asQueryEngine(),
        description: `Useful for questions about ${questionType}`
    }
}

async function initializeQueryTool(){
    const queryEngineTools = []
    Object.keys(topics).forEach(async (topic)=>{
        const initAction = await initializeAction(topic, topics[topic])
        queryEngineTools.push(initAction)
    })
    const queryEngine = RouterQueryEngine.fromDefaults({
        queryEngineTools: queryEngineTools
    })
    return new QueryEngineTool({
        queryEngine: queryEngine,
        metadata: {
            name: "uploaded_files",
            description: "A tool that can answer questions based on what is uploaded",
        },
    });
}

async function queryAgent(){
    const queryEngineTool = await initializeQueryTool()
    return new OpenAIAgent({
        tools: [queryEngineTool],
        verbose: true
    })
}

function emptyDirectory(){
    const directory = `${process.cwd()}/data`
    readdir(directory, (err, files)=>{
        if(err) console.error(`1 ${err}`)

        files.forEach(file=>{
            unlink(path.join(directory, file), err=>{
                if(err) console.error(`2 ${err}`)
            })
        })
    })
}

let agent = queryAgent()

async function sendQuery(body){
    const query = body.data
    const topic = body.topic || 'general'
    const filePath = topics[topic]
    if(filePath === undefined){
        return undefined
    }
    const queryEngine =  await initializeAction(topic, filePath)
    const answer = await (await queryEngine).queryEngine.query({query: query})
    return answer.toString()
}

async function sendQueryAgent(query){
    const answer = await (await agent).chat({message: query})
    return answer.toString()
}

router.options('/', cors())
/* GET users listing. */
router.get('/', function(req, res, next) {

    const body = new TextEncoder().encode("Lets chat");
  res.status(200).send({data:"Lets chat"});
});


// Uses the general queryEngine
router.options('/', cors())
router.post('/', async function(req, res, next){
    const message  = await sendQuery(req.body)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    if(message === undefined){
        res.status(200).send({message:'Something went wrong. Try again'});
    }
    res.status(200).send({message:message});
})

router.options('/upload', cors())
router.post('/upload',  async (req, res, next)=>{
    const fileName = ()=>{return `file-${Date.now()}-${Math.round(Math.random() * 1E9)}.pdf`}
    
    formidable({
        uploadDir: path.join(`${process.cwd()}`,'data'),
        filename: fileName,
        keepExtensions: true
    }).parse(req, async (err, fields, files)=>{

        if (err) {
            return res.status(400).json({ error: 'Error parsing form data' });
        }
        const {topic} = fields;
        const docs = files.file
        if (!docs) {
            return res.status(400).json({ error: 'Missing file' });
        }
        if(Array.isArray(docs) && docs.length>0 && Boolean(topic)){
            const dirPath = path.join(`${process.cwd()}`,'data', topic[0])
            topics[topic[0]] = dirPath
            await mkdir(dirPath, {recursive:true}).then( async ()=>{
                for(let i=0; i< docs.length; i++){
                    const doc = docs[i]
                    await rename(doc.filepath, path.join(dirPath, doc.newFilename), (err)=>{
                        if(err){
                            return res.status(500).json({error: err, message:'Error saving file'})
                        }
                    })
                }
            }).then(()=>{
                // initialize the agents 
        
                agent = queryAgent()
            })
            
        }
        
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/json");
        return res.json({message: "Upload complete. LLM ready to take questions"})
        })
})

router.options('/topics', cors())
router.get('/topics', (req, res, next)=>{
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    return res.json(Object.keys(topics))
})


// Ask the agent
router.options('/askagent', cors())
router.post('/askagent', async function(req, res, next) {
    const message = await sendQueryAgent(req.body.data)

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    res.status(200).send({message:message});
})

module.exports = router;
