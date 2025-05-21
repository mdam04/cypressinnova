
// MOCK_USER_FLOWS is no longer primarily used for populating flows,
// as flows are now identified by analyzing the repository.
// Kept for reference or potential fallback/testing if needed.
export const MOCK_USER_FLOWS: string[] = [
  "User Login",
  "User Registration",
  "Create New Item",
  "View Item Details",
  "Edit Existing Item",
  "Delete Item",
  "User Profile Update",
  "Search Functionality",
  "User Logout",
];

export type TestType = "E2E" | "Component";
