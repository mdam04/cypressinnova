
'use server';
/**
 * @fileOverview Saves a Cypress test file and attempts to open Cypress in headed mode.
 *
 * - executeCypressOpen - Saves the test and runs `cypress open`.
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
  status: z.enum(['launched', 'error', 'already-running']).describe('Status of the Cypress open attempt.'),
  message: z.string().describe('A message detailing the outcome.'),
  specPath: z.string().optional().describe('The full path to the saved spec file.'),
  detailedErrorLog: z.string().optional().describe('More detailed log in case of an error during launch.'),
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
    // Changed: Removed '--spec' flag, passing relativeSpecPath directly
    const cypressProcess = spawn('npx', ['cypress', 'open', relativeSpecPath], {
      cwd: repoPath,
      detached: true, 
      stdio: ['ignore', 'pipe', 'pipe'], 
    });

    cypressProcess.unref();

    cypressProcess.stdout?.on('data', (data) => {
      stdoutData += data.toString();
      if (stdoutData.includes('Cypress App port is already in use') && !cypressProcess.killed) {
        try {
          process.kill(cypressProcess.pid!, 'SIGTERM'); 
        } catch (e) {/* ignore */}
        resolve({
          status: 'already-running',
          message: `Cypress appears to be already running for project at ${repoPath}. Please switch to the existing Cypress window. Spec: ${relativeSpecPath}`,
          specPath: specFilePath,
          detailedErrorLog: stdoutData,
        });
        return;
      }
    });
    
    cypressProcess.stderr?.on('data', (data) => {
      stderrData += data.toString();
    });

    cypressProcess.on('error', (err) => {
      resolve({
        status: 'error',
        message: `Failed to start Cypress: ${err.message}.`,
        detailedErrorLog: `Spawn error: ${err.message}\nEnsure Cypress is installed in the project or globally.\nAssociated stderr (if any):\n${stderrData}`,
        specPath: specFilePath,
      });
    });

    cypressProcess.on('spawn', () => {
         setTimeout(() => { 
            if(cypressProcess.killed) return; 

            // Priority 1: Check for explicit errors from stderr
            if (stderrData.trim() !== '') {
                 resolve({
                    status: 'error',
                    message: `Cypress may have encountered an issue. Check the detailed log.`,
                    detailedErrorLog: `Stderr output:\n${stderrData.substring(0, 1000)}`,
                    specPath: specFilePath,
                });
                return;
            }

            // Priority 2: Check for positive stdout messages indicating launch
            if (stdoutData.includes('Opening Cypress') || stdoutData.includes('Still waiting to connect to Cypress') || stdoutData.includes('already running')) {
                 resolve({
                    status: 'launched',
                    message: `Cypress launched for spec: ${relativeSpecPath}. Check the Cypress Test Runner window.`,
                    specPath: specFilePath,
                    detailedErrorLog: `Stdout: ${stdoutData.substring(0,200)}`
                });
                return;
            }
            
            // Priority 3: If stdout is empty AND stderr is empty after timeout
            if (stdoutData.trim() === '' && stderrData.trim() === '') {
                 resolve({
                    status: 'launched',
                    message: `Cypress launch initiated for spec: ${relativeSpecPath}. No immediate output from Cypress; check your Cypress window.`,
                    specPath: specFilePath,
                });
                return;
            }

            // Fallback: Some other stdout, no stderr. Assume launched if no known error patterns in stdout.
            // Check stdout for common error indicators that might not go to stderr.
            if (stdoutData.toLowerCase().includes('error:') || stdoutData.toLowerCase().includes('failed to open')) {
                resolve({
                    status: 'error',
                    message: 'Cypress reported an issue on stdout. Check detailed logs.',
                    detailedErrorLog: `Stdout (potential error):\n${stdoutData.substring(0, 1000)}`,
                    specPath: specFilePath,
                });
                return;
            }
            
            resolve({
                status: 'launched',
                message: `Cypress launch initiated for spec: ${relativeSpecPath}. Check Cypress window.`,
                specPath: specFilePath,
                detailedErrorLog: `Stdout: ${stdoutData.substring(0, 200)}`
            });

        }, 5000); // Increased timeout to 5 seconds
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

