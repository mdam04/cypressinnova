
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
                structure += "Key dependencies: " + Object.keys(packageJson.dependencies).filter(k => ['next', 'react', 'vue', 'angular', '@sveltejs/kit'].includes(k)).join(', ') + "\n";
            }
        } catch (e: any) {
            structure += `Could not parse package.json: ${e.message}\n`;
            logOutput += `Warning: Could not parse package.json: ${e.message}\n`;
        }
      } else {
        structure += "No package.json found at root.\n";
      }

      const commonDirs = ['src/app', 'app', 'src/pages', 'pages', 'src/components', 'components', 'src/routes', 'routes'];
      let filesFound = 0;
      const maxFilesToList = 30; // Limit the number of files listed to keep the summary concise

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
        structure += "\nNo common framework directories (src/app, src/pages, etc.) found. Listing root items:\n";
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
  output: {schema: IdentifyUserFlowsOutputSchema.omit({analysisLog: true})}, // LLM only returns flows
  tools: [cloneRepositoryTool, readRepositoryStructureTool], // Though not directly used by prompt, makes them available conceptually
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

export async function identifyUserFlows(input: IdentifyUserFlowsInput): Promise<IdentifyUserFlowsOutput> {
  let tempRepoPath: string | undefined;
  let fullAnalysisLog = "";

  try {
    const cloneResult = await cloneRepositoryTool(input);
    tempRepoPath = cloneResult.tempPath;
    fullAnalysisLog += cloneResult.log;

    const structureResult = await readRepositoryStructureTool({ repoPath: tempRepoPath });
    fullAnalysisLog += structureResult.log;

    const promptInput = {
      ...input,
      analyzedStructure: structureResult.structureSummary,
    };

    const {output} = await prompt(promptInput);
    
    if (tempRepoPath && fs.existsSync(tempRepoPath)) {
      fs.rmSync(tempRepoPath, { recursive: true, force: true });
      fullAnalysisLog += `Successfully cleaned up temporary directory: ${tempRepoPath}\n`;
    }
    
    if (!output) {
      return { identifiedFlows: [], analysisLog: fullAnalysisLog + "LLM returned no output." };
    }

    // Ensure identifiedFlows is always an array
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
    
    return { identifiedFlows: flows, analysisLog: fullAnalysisLog };

  } catch (error: any) {
    fullAnalysisLog += `Error in identifyUserFlows flow: ${error.message || error.toString()}\n`;
    if (tempRepoPath && fs.existsSync(tempRepoPath)) {
      fs.rmSync(tempRepoPath, { recursive: true, force: true });
      fullAnalysisLog += `Cleaned up temporary directory due to error: ${tempRepoPath}\n`;
    }
    // Re-throw as a more user-friendly error, or handle as appropriate
    console.error("Identify User Flows Error:", fullAnalysisLog, error);
    throw new Error(`Failed to identify user flows. Details: ${error.message}. Check server logs for more info.`);
  }
}

const identifyUserFlowsFlow = ai.defineFlow(
  {
    name: 'identifyUserFlowsFlow', //This is the registered flow name. The exported function is just a wrapper.
    inputSchema: IdentifyUserFlowsInputSchema,
    outputSchema: IdentifyUserFlowsOutputSchema,
    tools: [cloneRepositoryTool, readRepositoryStructureTool],
  },
  identifyUserFlows // Use the refactored function
);

// Note: The exported function `identifyUserFlows` is what components call.
// The `identifyUserFlowsFlow` is what's registered with Genkit and technically executed by it.
// We keep `identifyUserFlows` as the direct async function for clarity and easier local logic before/after LLM.
// However, Genkit's standard pattern is to directly pass the async function to defineFlow.
// For this case, we will call the registered flow, but the main logic is in the `identifyUserFlows` async function.
// To align better, we'll make the exported function call the registered flow.

export async function identifyUserFlowsWrapper(input: IdentifyUserFlowsInput): Promise<IdentifyUserFlowsOutput> {
  // This wrapper now calls the Genkit-defined flow
  // This is more aligned with how Genkit tools and flows are typically invoked.
  // The actual implementation has been moved into the function passed to ai.defineFlow.
  return identifyUserFlowsFlow(input);
}
// The previous `identifyUserFlows` function is now the main implementation for the flow.
// The exported function should just be `identifyUserFlows` which is the one registered with Genkit.
// The component will call `identifyUserFlows(input)` from the import, which refers to the flow function.
// Let's rename the wrapper to avoid confusion.
// The final structure:
// - `identifyUserFlows` (async function containing the logic, passed to defineFlow)
// - `identifyUserFlowsFlow` (the Genkit registered flow, which is `identifyUserFlows`)
// - The exported function called by the UI will be `identifyUserFlows` (the flow itself)

// Correcting the export structure:
// The actual `identifyUserFlows` async function is the core logic.
// `ai.defineFlow` wraps this logic. The result of `ai.defineFlow` is the callable flow.

// So the page.tsx should import and call the result of ai.defineFlow.
// Let's rename the flow to avoid conflict and export the defined flow.

const internalIdentifyUserFlowsLogic = identifyUserFlows; // Keep the logic separate for clarity

const actualRegisteredFlow = ai.defineFlow(
  {
    name: 'identifyUserFlowsFlow',
    inputSchema: IdentifyUserFlowsInputSchema,
    outputSchema: IdentifyUserFlowsOutputSchema,
    tools: [cloneRepositoryTool, readRepositoryStructureTool],
  },
  internalIdentifyUserFlowsLogic
);

// Export the registered flow for components to call
export { actualRegisteredFlow as identifyUserFlows };
