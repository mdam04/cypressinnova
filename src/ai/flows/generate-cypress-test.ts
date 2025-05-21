// use server'

/**
 * @fileOverview Generates Cypress test code from a user flow description.
 *
 * - generateCypressTest - A function that generates Cypress test code.
 * - GenerateCypressTestInput - The input type for the generateCypressTest function.
 * - GenerateCypressTestOutput - The return type for the generateCypressTest function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateCypressTestInputSchema = z.object({
  flowDescription: z.string().describe('The description of the user flow to test.'),
  testType: z.enum(['E2E', 'Component']).describe('The type of test to generate: E2E or Component.'),
  applicationDetails: z.string().describe('Details about the application including the URL and repository link.'),
});
export type GenerateCypressTestInput = z.infer<typeof GenerateCypressTestInputSchema>;

const GenerateCypressTestOutputSchema = z.object({
  testCode: z.string().describe('The generated Cypress test code.'),
});
export type GenerateCypressTestOutput = z.infer<typeof GenerateCypressTestOutputSchema>;

export async function generateCypressTest(input: GenerateCypressTestInput): Promise<GenerateCypressTestOutput> {
  return generateCypressTestFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateCypressTestPrompt',
  input: {schema: GenerateCypressTestInputSchema},
  output: {schema: GenerateCypressTestOutputSchema},
  prompt: `You are an expert Cypress test generator. Based on the provided user flow description, generate Cypress test code.

  User Flow Description: {{{flowDescription}}}
  Test Type: {{{testType}}}
  Application Details: {{{applicationDetails}}}

  Ensure the generated code is valid Cypress code and includes appropriate assertions to validate the user flow.
  Return only the code, do not include explanations or comments outside of the test code.
  `,
});

const generateCypressTestFlow = ai.defineFlow(
  {
    name: 'generateCypressTestFlow',
    inputSchema: GenerateCypressTestInputSchema,
    outputSchema: GenerateCypressTestOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
