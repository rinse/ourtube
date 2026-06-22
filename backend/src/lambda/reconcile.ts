import { createAppConfig } from '../config';
import { createDependencies } from '../dependencies';
import { reconcileStuckConversions } from '../conversion/reconcile';

const deps = createDependencies(createAppConfig());

export async function handler(): Promise<void> {
  const result = await reconcileStuckConversions(deps);
  console.log(
    `[reconcile] scanned=${result.scanned} recovered=${result.recovered.length}`,
    result.recovered.length > 0 ? result.recovered : '',
  );
}
