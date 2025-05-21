# **App Name**: Cypress Pilot

## Core Features:

- Repo Analysis: Clone the provided GitHub repository and analyze its structure to identify user flows.
- Flow Selection: Present identified user flows as selectable options in a dropdown menu.
- Test Type Selection: After flow selection, prompt the user to choose between generating an End-to-End (E2E) test or a Component test for the selected flow.
- Cypress Test Generation: Use an LLM to generate Cypress test code based on the selected user flow and test type, with the LLM using its reasoning ability to include specific steps and assertions. This step will leverage an LLM 'tool'.
- Test Execution and Feedback: Automatically run the generated Cypress test in headless mode and display the results, including logs and the generated test code, with clear error and suggestion reporting for fixing test issues related to missing selectors, structure errors etc.

## Style Guidelines:

- Primary color: HSL(210, 70%, 50%) - A vibrant, saturated blue (#1A82E2) to convey trust and precision.
- Background color: HSL(210, 20%, 95%) - A very light, desaturated blue (#F0F5FA) for a clean and unobtrusive backdrop.
- Accent color: HSL(180, 60%, 40%) - A teal color (#2ba9a4), offering a refreshing contrast that indicates clearly the interactive or actionable components in the design.
- Clean, sans-serif font to ensure code and results are easily readable.
- Simple, clear icons representing different test states (success, failure, pending) and actions (run, debug, etc.).
- Split-screen layout to display the test code and test results side by side for easy comparison.