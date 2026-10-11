<script lang="ts">
  import type { ArticleSummary } from '@pnp/shared';

  let { article }: { article: Pick<ArticleSummary, 'hasSheet'> } = $props();
</script>

<span aria-hidden="true" title={article.hasSheet ? 'mit FATE-Bogen' : undefined}>{article.hasSheet ? '🎭' : '📄'}</span>
