import { candidateToSubscription } from "./importCandidate";
import { listMailboxesAsync } from "./persist";
import {
    createMailProvider,
    MailConnectError,
    MailScanUnverifiedError,
} from "./providers";

export async function importFromConnectedMailboxes(opts: {
  userId: string;
  existing: Subscription[];
  addSubscription: (subscription: Subscription) => Promise<void>;
}): Promise<{ imported: number; errors: string[] }> {
  const boxes = await listMailboxesAsync();
  let imported = 0;
  const errors: string[] = [];
  const seen = new Set(
    opts.existing.map((s) => `${s.name}::${s.paymentMethod ?? ""}`),
  );

  for (const box of boxes) {
    try {
      const provider = createMailProvider(box.providerId, opts.userId);
      const result = await provider.scan({ mailboxId: box.mailboxId });
      for (const candidate of result.candidates) {
        const key = `${candidate.merchant}::${candidate.mailboxId}`;
        if (seen.has(key)) continue;
        await opts.addSubscription(candidateToSubscription(candidate));
        seen.add(key);
        imported += 1;
      }
    } catch (error) {
      const message =
        error instanceof MailScanUnverifiedError ||
        error instanceof MailConnectError
          ? error.message
          : error instanceof Error
            ? error.message
            : "scan failed";
      errors.push(`${box.mailboxId}: ${message}`);
    }
  }

  return { imported, errors };
}
