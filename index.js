import inquirer from 'inquirer';
import chalk from 'chalk';
import { simpleGit } from 'simple-git';
import path, { dirname } from 'path';
import {fileURLToPath} from "url";
import commandLineArgs from 'command-line-args'
import fsPromises from "fs/promises";
import OpenAPIParser from '@readme/openapi-parser'
import { exec }  from 'child_process'
import util from 'util'
const execPromise = util.promisify(exec);

const CLIOptionDefinitions = [
    { name: 'git', type: String },
    { name: 'spec', type: String },
    { name: 'dir', type: String }
]

function collectCLIArgs() {
    const options = commandLineArgs(CLIOptionDefinitions)

    CLIOptionDefinitions.forEach((definitions) => {
        if (!options[definitions.name]) {
            throw new Error(`Не указана CLI опция ${definitions.name}`)
        }
    })

    return options
}


function getRepoName(gitURL) {
    const parts = gitURL.split('/')

    return  parts[parts.length - 1].replace('.git', '')
}

async function removeDir(dir) {
    await fsPromises.rm(dir, {
        recursive: true,
        force: true,
    });
}

async function cloneRepo(gitURL) {
    const options = {
        baseDir: __dirname,
        binary: 'git',
        maxConcurrentProcesses: 6,
        trimmed: false,
    };

    const git = simpleGit(options);

    const r = await git.clone(gitURL);
}

async function removeRepo(repoName) {
    // чистим старую папку, чтобы не получить ошибку при клонировании
    await removeDir(path.resolve(__dirname, repoName));
}

async function getSpecPath(repoName, spec) {
    return  path.resolve(__dirname, `${repoName}/${spec}`)
}

async function getSpecFileNames(specDir) {
    return (await fsPromises.readdir(specDir))
        .filter((fileName) => !fileName.includes('.json'));
}

function collectSpecPaths(fileNames, specDir) {
    return fileNames.map((name) => `${specDir}/${name}`)
}

async function parseDocuments(specPaths) {
    return Promise.all(specPaths.map((path) => OpenAPIParser.parse(path)))
}

function isEvent(key) {
    return key.includes('.')
}

function collectEvents(documents) {
    const events = []

    documents.forEach((document) => {
        const schemaKeys = Object.keys(document.components.schemas)

        schemaKeys.forEach((key) => {
            if (isEvent(key)) {
                events.push(key)
            }
        })
    })

    return events
}

async function isUsageEvent(event, appDir) {
    try {
        await execPromise(`grep -r -w '${event}' ${appDir}`)
        return true
    } catch (e) {
        return false
    }
}

async function findUnusedEvents(events, appDir) {
    const result = []
    const usageList = await Promise.all(
        events.map((event) => isUsageEvent(event, appDir))
    )

    usageList.forEach((use, index) => {
        if (!use) {
            result.push(events[index])
        }
    })

    return result
}

function printEvents(events) {
    let result = ''

    events.forEach((event, index) => {
        result += `${ index !== 0 ? '\n' : ''}${event}`
    })

    console.log(chalk.blue.bold('Неиспользуемые события:'))
    console.log(result)
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliOptions = collectCLIArgs()


async function main() {
    const gitURL = cliOptions.git
    const spec = cliOptions.spec
    const appDir = cliOptions.dir
    const repoName = getRepoName(gitURL)
    const specDir = await getSpecPath(repoName, spec)

    await removeRepo(repoName)
    console.log('Скачивание репозитория...')
    await cloneRepo(gitURL)
    const specFileNames = await getSpecFileNames(specDir);
    const specPaths = collectSpecPaths(specFileNames, specDir)
    console.log('Анализ спецификации...')
    const documents = await parseDocuments(specPaths)
    console.log('Сбор неиспользуемых событий...')
    const events = collectEvents(documents)
    const unusedEvents = await findUnusedEvents(events, appDir)

    console.log('Отчистка временных файлов...')
    await removeRepo(repoName)

    console.log(chalk.green.bold('ГОТОВО!'))
    printEvents(unusedEvents)
}

main();
