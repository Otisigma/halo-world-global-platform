const checks = [
  [page.includes('id="accountDialog"') && script.includes('accountButton?.addEventListener("click"') && script.includes("identity.login") && script.includes("identity.signup") && script.includes("identity?.logout"), "connects the account button to sign in, signup, and sign out behavior"],
  [fn.includes("verifyRequestOrigin") && fn.includes("ensureMembership") && fn.includes("VALID_PURPOSES"), "protects API with origin verification and membership controls"],
  [fn.includes("handleGenerate") && fn.includes("gpt-5.4-mini") && fn.includes("Never invent credits"), "generates grounded album concepts through supported AI Gateway model"],
  [fn.includes("handleCreate") && fn.includes("handleSave") && fn.includes("handleGet"), "supports create, generate, save, and get API actions"],
];
