
'use server';
/**
 * @fileOverview Saves a Cypress test file and attempts to run Cypress in headed mode.
 *
 * - executeCypressOpen - Saves the test and runs `cypress run --headed --spec <spec>`.
 * - ExecuteCypressOpenInput - Input type for the flow.
 * - ExecuteCypressOpenOutput - Output type for the flow.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const ExecuteCypressOpenInputSchema = z.object({
  testCode: z.string().describe('The Cypress test code to be saved and executed.'),
  repoPath: z.string().describe('The absolute local path to the cloned repository (Cypress project root).'),
  specFileName: z.string().describe('The desired file name for the spec, e.g., "user-login.cy.ts".'),
});
export type ExecuteCypressOpenInput = z.infer<typeof ExecuteCypressOpenInputSchema>;

const ExecuteCypressOpenOutputSchema = z.object({
  status: z.enum(['launched', 'error']).describe('Status of the Cypress run attempt.'),
  message: z.string().describe('A message detailing the outcome.'),
  specPath: z.string().optional().describe('The full path to the saved spec file.'),
  detailedErrorLog: z.string().optional().describe('More detailed log in case of an error during launch or run.'),
});
export type ExecuteCypressOpenOutput = z.infer<typeof ExecuteCypressOpenOutputSchema>;

async function executeCypressOpenLogic(input: ExecuteCypressOpenInput): Promise<ExecuteCypressOpenOutput> {
  const { testCode, repoPath, specFileName } = input;

  if (!fs.existsSync(repoPath)) {
    return { 
      status: 'error', 
      message: `Repository path does not exist: ${repoPath}`,
      detailedErrorLog: `Repository path check failed for: ${repoPath}`,
    };
  }

  const cypressE2eDir = path.join(repoPath, 'cypress', 'e2e');
  const specFilePath = path.join(cypressE2eDir, specFileName);

  try {
    // Ensure the cypress/e2e directory exists
    if (!fs.existsSync(cypressE2eDir)) {
      fs.mkdirSync(cypressE2eDir, { recursive: true });
    }

    // Save the test code to the spec file
    fs.writeFileSync(specFilePath, testCode, 'utf8');
  } catch (error: any) {
    return {
      status: 'error',
      message: `Failed to save test file at ${specFilePath}: ${error.message}`,
      detailedErrorLog: `File save error: ${error.message}\n${error.stack || ''}`,
      specPath: specFilePath,
    };
  }

  // Path to the spec file relative to the Cypress project root
  const relativeSpecPath = path.join('cypress', 'e2e', specFileName);

  return new Promise((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    // Changed: Use 'cypress run --headed --spec'
    const cypressProcess = spawn('npx', ['cypress', 'run', '--headed', '--spec', relativeSpecPath], {
      cwd: repoPath,
      detached: true, 
      stdio: ['ignore', 'pipe', 'pipe'], 
    });

    cypressProcess.unref();

    cypressProcess.stdout?.on('data', (data) => {
      stdoutData += data.toString();
    });
    
    cypressProcess.stderr?.on('data', (data) => {
      stderrData += data.toString();
    });

    cypressProcess.on('error', (err) => {
      resolve({
        status: 'error',
        message: `Failed to start Cypress: ${err.message}.`,
        detailedErrorLog: `Spawn error: ${err.message}\nEnsure Cypress is installed in the project or globally and necessary dependencies (like browsers) are present.\nAssociated stderr (if any):\n${stderrData}`,
        specPath: specFilePath,
      });
    });

    cypressProcess.on('spawn', () => {
         setTimeout(() => { 
            if(cypressProcess.killed) return; 

            // Priority 1: Check for explicit errors from stderr
            if (stderrData.toLowerCase().includes('xvfb')) { 
                 resolve({
                    status: 'error',
                    message: `Cypress Headed Run Failed: Missing Xvfb dependency.`,
                    detailedErrorLog: `Xvfb is required for headed Cypress execution in this environment. Please install Xvfb and try again. Error details:\n${stderrData.substring(0, 1000)}\nStdout (if any):\n${stdoutData.substring(0,500)}`,
                    specPath: specFilePath,
                });
                return;
            }
            if (stderrData.toLowerCase().includes('cannot find module') || 
                stderrData.toLowerCase().includes('no version of') || // e.g., no version of Chrome found
                stderrData.toLowerCase().includes('failed to connect') ||
                (stderrData.trim() !== '' && !stdoutData.toLowerCase().includes('run starting') && !stdoutData.toLowerCase().includes('running:'))) { 
                 resolve({
                    status: 'error',
                    message: `Cypress run may have encountered an issue. Check the detailed log.`,
                    detailedErrorLog: `Stderr output likely indicates an error:\n${stderrData.substring(0, 1000)} \nStdout:\n${stdoutData.substring(0,500)}`,
                    specPath: specFilePath,
                });
                return;
            }

            // Priority 2: Check for positive stdout messages indicating run start
            if (stdoutData.toLowerCase().includes('(run starting)') || stdoutData.toLowerCase().includes('running:') || stdoutData.toLowerCase().includes('devtools listening')) {
                 resolve({
                    status: 'launched',
                    message: `Cypress headed test run initiated for spec: ${relativeSpecPath}. Check the browser window.`,
                    specPath: specFilePath,
                    detailedErrorLog: `Stdout (run initiated):\n${stdoutData.substring(0,500)}\nStderr (if any):\n${stderrData.substring(0,300)}`
                });
                return;
            }
            
            // Priority 3: If stdout is empty AND stderr is empty after timeout (less likely for `cypress run`)
            if (stdoutData.trim() === '' && stderrData.trim() === '') {
                 resolve({
                    status: 'launched', // Optimistic assumption
                    message: `Cypress headed run initiated for spec: ${relativeSpecPath}. No immediate output; check for a browser window.`,
                    specPath: specFilePath,
                });
                return;
            }
            
            // Fallback: Some other stdout, no critical stderr. Assume launched if no known error patterns.
            if (stdoutData.toLowerCase().includes('error:') || stdoutData.toLowerCase().includes('failed')) { // Check stdout for errors too
                resolve({
                    status: 'error',
                    message: 'Cypress reported an issue on stdout during run initiation. Check detailed logs.',
                    detailedErrorLog: `Stdout (potential error):\n${stdoutData.substring(0, 1000)}\nStderr (if any):\n${stderrData.substring(0,300)}`,
                    specPath: specFilePath,
                });
                return;
            }
            
            // Default to launched if no clear errors and some stdout activity that isn't an obvious error
            resolve({
                status: 'launched',
                message: `Cypress headed test run initiated for spec: ${relativeSpecPath}. Check browser window.`,
                specPath: specFilePath,
                detailedErrorLog: `Stdout: ${stdoutData.substring(0, 500)}\nStderr (if any):\n${stderrData.substring(0,300)}`
            });

        }, 5000); // 5 seconds timeout
    });
  });
}

export const executeCypressOpen = ai.defineFlow(
  {
    name: 'executeCypressOpenFlow',
    inputSchema: ExecuteCypressOpenInputSchema,
    outputSchema: ExecuteCypressOpenOutputSchema,
  },
  executeCypressOpenLogic
);

