
'use server';
/**
 * @fileOverview Identifies potential user flows by cloning and analyzing a GitHub repository.
 *
 * - identifyUserFlows - A function that clones a repo, analyzes its structure, and uses an LLM to identify user flows.
 * - IdentifyUserFlowsInput - The input type for the identifyUserFlows function.
 * - IdentifyUserFlowsOutput - The return type for the identifyUserFlows function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const IdentifyUserFlowsInputSchema = z.object({
  repoUrl: z.string().url().describe('The URL of the GitHub repository to analyze.'),
  appUrl: z.string().url().optional().describe('The URL of the running application, for context.'),
});
export type IdentifyUserFlowsInput = z.infer<typeof IdentifyUserFlowsInputSchema>;

const IdentifyUserFlowsOutputSchema = z.object({
  identifiedFlows: z.array(z.string()).describe('A list of identified potential user flows based on the repository analysis.'),
  analysisLog: z.string().optional().describe('Log of the analysis process, for debugging or info.'),
  clonedRepoPath: z.string().optional().describe('The local path where the repository was cloned.'),
});
export type IdentifyUserFlowsOutput = z.infer<typeof IdentifyUserFlowsOutputSchema>;

const CloneRepositoryInputSchema = z.object({
  repoUrl: z.string().url(),
});
const CloneRepositoryOutputSchema = z.object({
  tempPath: z.string(),
  log: z.string(),
});

const cloneRepositoryTool = ai.defineTool(
  {
    name: 'cloneRepositoryTool',
    description: 'Clones a public GitHub repository to a temporary local directory.',
    inputSchema: CloneRepositoryInputSchema,
    outputSchema: CloneRepositoryOutputSchema,
  },
  async ({repoUrl}) => {
    let tempDir = '';
    let logOutput = `Attempting to clone ${repoUrl}...\n`;
    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cypress-pilot-repo-'));
      logOutput += `Created temporary directory: ${tempDir}\n`;
      execSync(`git clone --depth 1 ${repoUrl} .`, { cwd: tempDir, stdio: 'pipe' });
      logOutput += `Successfully cloned ${repoUrl} into ${tempDir}\n`;
      return { tempPath: tempDir, log: logOutput };
    } catch (error: any) {
      logOutput += `Error cloning repository: ${error.message || error.toString()}\n`;
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        logOutput += `Cleaned up temporary directory: ${tempDir}\n`;
      }
      throw new Error(`Failed to clone repository: ${error.message}. Log: ${logOutput}`);
    }
  }
);

const ReadRepositoryStructureInputSchema = z.object({
  repoPath: z.string(),
});
const ReadRepositoryStructureOutputSchema = z.object({
  structureSummary: z.string(),
  log: z.string(),
});

const readRepositoryStructureTool = ai.defineTool(
  {
    name: 'readRepositoryStructureTool',
    description: 'Reads the file structure of a cloned repository and generates a summary.',
    inputSchema: ReadRepositoryStructureInputSchema,
    outputSchema: ReadRepositoryStructureOutputSchema,
  },
  async ({repoPath}) => {
    let structure = `Repository structure analysis for path: ${repoPath}\n`;
    let logOutput = `Analyzing structure at ${repoPath}...\n`;

    try {
      // Check for package.json
      const packageJsonPath = path.join(repoPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        structure += "\nFound package.json. Dependencies might indicate framework (e.g., 'next', 'react', 'vue', 'angular').\n";
        try {
            const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
            const packageJson = JSON.parse(packageJsonContent);
            structure += `Package name: ${packageJson.name || 'N/A'}\n`;
            if (packageJson.dependencies) {
                structure += "Key dependencies: " + Object.keys(packageJson.dependencies).filter(k => ['next', 'react', 'vue', 'angular', '@sveltejs/kit', 'cypress'].includes(k)).join(', ') + "\n";
            }
             if (packageJson.devDependencies) {
                structure += "Key devDependencies: " + Object.keys(packageJson.devDependencies).filter(k => ['cypress'].includes(k)).join(', ') + "\n";
            }
        } catch (e: any) {
            structure += `Could not parse package.json: ${e.message}\n`;
            logOutput += `Warning: Could not parse package.json: ${e.message}\n`;
        }
      } else {
        structure += "No package.json found at root.\n";
      }

      const commonDirs = ['src/app', 'app', 'src/pages', 'pages', 'src/components', 'components', 'src/routes', 'routes', 'cypress/e2e', 'cypress/integration'];
      let filesFound = 0;
      const maxFilesToList = 30; 

      for (const dir of commonDirs) {
        const fullDirPath = path.join(repoPath, dir);
        if (fs.existsSync(fullDirPath)) {
          structure += `\nDirectory: /${dir}\n`;
          const items = fs.readdirSync(fullDirPath, { withFileTypes: true });
          items.slice(0, maxFilesToList - filesFound).forEach(item => {
            structure += `  - ${item.name}${item.isDirectory() ? '/' : ''}\n`;
          });
          filesFound += items.length;
          if (items.length > (maxFilesToList - filesFound)) {
            structure += `  ... (and more files/subdirectories)\n`;
          }
        }
      }
       if (filesFound === 0) {
        structure += "\nNo common framework or test directories found. Listing root items:\n";
        const rootItems = fs.readdirSync(repoPath, { withFileTypes: true });
        rootItems.slice(0, maxFilesToList).forEach(item => {
            structure += `  - ${item.name}${item.isDirectory() ? '/' : ''}\n`;
        });
        if (rootItems.length > maxFilesToList) {
             structure += `  ... (and more files/subdirectories)\n`;
        }
      }
      logOutput += `Structure analysis complete. Summary generated.\n`;
      return { structureSummary: structure, log: logOutput };
    } catch (error: any) {
      logOutput += `Error reading repository structure: ${error.message || error.toString()}\n`;
      throw new Error(`Failed to read repository structure: ${error.message}. Log: ${logOutput}`);
    }
  }
);

const IdentifyUserFlowsPromptInputSchema = IdentifyUserFlowsInputSchema.extend({
    analyzedStructure: z.string().describe('A textual summary of the cloned repository\'s structure and key files.'),
});

const prompt = ai.definePrompt({
  name: 'identifyUserFlowsPrompt',
  input: {schema: IdentifyUserFlowsPromptInputSchema},
  output: {schema: IdentifyUserFlowsOutputSchema.omit({analysisLog: true, clonedRepoPath: true})}, // LLM only returns flows
  prompt: `You are an expert software analyst. Based on the provided repository structure analysis and optionally the application URL, identify and list potential user flows.
  Focus on sequences of actions a user might take.

  Repository URL (for context): {{{repoUrl}}}
  {{#if appUrl}}Application URL (for context): {{{appUrl}}}{{/if}}

  Analyzed Repository Structure:
  {{{analyzedStructure}}}

  List the identified user flows. For example: "User Login", "Create New Product", "View Dashboard", "Update Profile Settings".
  Return *only* the list of identified user flows as a JSON array of strings.
  Example output:
  {
    "identifiedFlows": ["User Login", "View Dashboard"]
  }
  `,
});

// This function contains the core logic for the flow
async function internalIdentifyUserFlowsLogic(input: IdentifyUserFlowsInput): Promise<IdentifyUserFlowsOutput> {
  let tempRepoPath: string | undefined;
  let fullAnalysisLog = "";

  try {
    const cloneResult = await cloneRepositoryTool(input);
    tempRepoPath = cloneResult.tempPath; // Store for returning
    fullAnalysisLog += cloneResult.log;

    const structureResult = await readRepositoryStructureTool({ repoPath: tempRepoPath });
    fullAnalysisLog += structureResult.log;

    const promptInput = {
      ...input,
      analyzedStructure: structureResult.structureSummary,
    };

    const {output} = await prompt(promptInput);
    
    // On success, DO NOT clean up tempRepoPath. It will be returned.
    // Cleanup will only happen if an error occurs within this flow.
    
    if (!output) {
      // If LLM fails, still cleanup tempRepoPath as it's not useful.
      if (tempRepoPath && fs.existsSync(tempRepoPath)) {
        fs.rmSync(tempRepoPath, { recursive: true, force: true });
        fullAnalysisLog += `Cleaned up temporary directory due to LLM returning no output: ${tempRepoPath}\n`;
        tempRepoPath = undefined; // Clear the path
      }
      return { identifiedFlows: [], analysisLog: fullAnalysisLog + "LLM returned no output.", clonedRepoPath: tempRepoPath };
    }

    let flows = output.identifiedFlows;
    if (flows && !Array.isArray(flows)) {
        fullAnalysisLog += "Warning: LLM returned non-array for identifiedFlows, attempting to adapt.\n";
        if (typeof flows === 'string') {
            flows = (flows as string).split(/,|\n/).map(s => s.trim()).filter(s => s.length > 0);
        } else {
            flows = [];
        }
    } else if (!flows) {
        flows = [];
    }
    
    return { identifiedFlows: flows, analysisLog: fullAnalysisLog, clonedRepoPath: tempRepoPath };

  } catch (error: any) {
    fullAnalysisLog += `Error in identifyUserFlows flow: ${error.message || error.toString()}\n`;
    // Clean up temp directory if an error occurred anywhere in the try block
    if (tempRepoPath && fs.existsSync(tempRepoPath)) {
      fs.rmSync(tempRepoPath, { recursive: true, force: true });
      fullAnalysisLog += `Cleaned up temporary directory due to error: ${tempRepoPath}\n`;
    }
    console.error("Identify User Flows Error:", fullAnalysisLog, error);
    throw new Error(`Failed to identify user flows. Details: ${error.message}. Log: ${fullAnalysisLog}`);
  }
}

const actualRegisteredFlow = ai.defineFlow(
  {
    name: 'identifyUserFlowsFlow',
    inputSchema: IdentifyUserFlowsInputSchema,
    outputSchema: IdentifyUserFlowsOutputSchema,
    tools: [cloneRepositoryTool, readRepositoryStructureTool], // Tools are available to the flow execution
  },
  internalIdentifyUserFlowsLogic // Pass the function containing the logic
);

// Export the registered flow for components to call
export { actualRegisteredFlow as identifyUserFlows };
