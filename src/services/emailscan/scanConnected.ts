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
  updateSubscription?: (
    id: string,
    data: Partial<Subscription>,
  ) => Promise<void>;
}): Promise<{ imported: number; errors: string[] }> {
  const boxes = await listMailboxesAsync();
  let imported = 0;
  const errors: string[] = [];
  const existingByKey = new Map(
    opts.existing.map((s) => [`${s.name}::${s.paymentMethod ?? ""}`, s]),
  );

  for (const box of boxes) {
    try {
      const provider = createMailProvider(box.providerId, opts.userId);
      const result = await provider.scan({ mailboxId: box.mailboxId });
      const keep = result.candidates.filter(
        (c) =>
          c.kind === "recurring" || c.kind === "sparse" || c.kind === "free",
      );
      for (const candidate of keep) {
        const key = `${candidate.merchant}::${candidate.mailboxId}`;
        const already = existingByKey.get(key);
        const next = candidateToSubscription(candidate);
        if (already) {
          const richer =
            (already.priceUnknown && !next.priceUnknown) ||
            (candidate.amount !== undefined &&
              candidate.amount !== already.price);
          if (richer && opts.updateSubscription) {
            await opts.updateSubscription(already.id, {
              price: next.price,
              priceUnknown: next.priceUnknown,
              currency: next.currency,
              billing: next.billing,
              frequency: next.frequency,
              category: next.category,
            });
            existingByKey.set(key, { ...already, ...next, id: already.id });
            imported += 1;
          }
          continue;
        }
        await opts.addSubscription(next);
        existingByKey.set(key, next);
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
