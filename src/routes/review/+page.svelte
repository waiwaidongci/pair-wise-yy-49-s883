<script lang="ts">
  import { enhance } from '$app/forms'
  import type { ActionData } from './$types'
  import { curriculumStore } from '$lib/stores'
  import type { ImportResult } from '$lib/stores'
  let { form }: { form: ActionData } = $props()
  let selectedIds = $state<string[]>([])
  let reviewComments = $state<Record<string, string>>({})
  let importResults = $state<Record<string, ImportResult>>({})
  let weightFixes = $state<Record<string, number>>({})
  const pending = $derived($curriculumStore.reviewItems.filter((item) => item.status === '待审阅'))
  const courseNames = $derived($curriculumStore.nodes.filter((node) => node.type === '课程'))
  const requirements = $derived($curriculumStore.nodes.filter((node) => node.type === '毕业要求'))

  function review(item: (typeof $curriculumStore.reviewItems)[number], status: '已附议' | '已退回') {
    curriculumStore.updateReview(item.id, status, reviewComments[item.id] || (status === '已附议' ? '证据充分，同意纳入修订。' : '请补充可验证的评分记录。'))
  }

  function bulkApprove() {
    selectedIds.forEach((id) => {
      const item = $curriculumStore.reviewItems.find((entry) => entry.id === id)
      if (item) curriculumStore.updateReview(id, '已附议', '批量附议：证据链完整。')
    })
    selectedIds = []
  }

  function runImport(receiptId: string) {
    const result = curriculumStore.importReceipt(receiptId)
    importResults[receiptId] = result
    result.failures.forEach((failure) => {
      const item = $curriculumStore.receipts.find((receipt) => receipt.id === receiptId)?.items.find((entry) => entry.id === failure.itemId)
      if (item && weightFixes[failure.itemId] === undefined) weightFixes[failure.itemId] = item.weight
    })
  }

  function fixAndRetry(receiptId: string, itemId: string) {
    const weight = weightFixes[itemId]
    if (typeof weight === 'number' && !Number.isNaN(weight)) curriculumStore.fixReceiptItem(receiptId, itemId, weight)
    runImport(receiptId)
  }
</script>

<svelte:head><title>课程改革审阅</title></svelte:head>

<section class="page">
  <div class="page-head">
    <div><p class="eyebrow">REFORM REVIEW / 改革审阅</p><h1>修订提交与逐项审阅</h1><p class="muted">Form Actions 在服务端使用 Zod 校验；退回必须补充证据要求。</p></div>
    <div class="actions"><button class="btn-secondary" disabled={selectedIds.length === 0} onclick={bulkApprove}>批量附议 {selectedIds.length ? `(${selectedIds.length})` : ''}</button><button class="btn-secondary" onclick={() => window.print()}>打印审阅单</button></div>
  </div>

  {#if form?.success}
    <div class="notice success">修订 {form.item?.id} 已提交，进入院系审阅队列。</div>
  {:else if form?.errors}
    <div class="notice error">表单未通过校验：{Object.values(form.errors).flat().join('；')}</div>
  {/if}

  <section class="panel receipts">
    <div class="panel-head"><h3>离线回执合并</h3><span class="muted">当前修订 {$curriculumStore.revision} · 过期或超范围项不覆盖，仅列出冲突与现场值</span></div>
    <div class="receipt-list">
      {#each $curriculumStore.receipts as receipt}
        {@const remaining = receipt.items.filter((item) => !item.merged)}
        {@const result = importResults[receipt.id]}
        <article class="receipt">
          <header>
            <div>
              <strong>{receipt.id} · {receipt.teacher}</strong>
              <small>负责 {receipt.requirements.join('、')} · {receipt.receivedAt} 收到</small>
            </div>
            <span class="rev-tag" class:stale={receipt.baseRevision !== $curriculumStore.revision}>收到版本 {receipt.baseRevision}{receipt.baseRevision === $curriculumStore.revision ? ' · 与当前一致' : ' · 已过期'}</span>
          </header>
          <table>
            <thead><tr><th>回执项</th><th>课程映射</th><th>回执值</th><th>状态</th><th>修正</th></tr></thead>
            <tbody>
              {#each receipt.items as item}
                {@const failed = result?.failures.find((failure) => failure.itemId === item.id)}
                <tr>
                  <td>{item.id}</td>
                  <td>{item.requirementId} → {item.courseId}<small>{item.note}</small></td>
                  <td>{item.relation} · {item.weight}</td>
                  <td>{#if item.merged}<span class="tag done">已并入</span>{:else}<span class="tag">待并入</span>{/if}</td>
                  <td class="fix-cell">
                    {#if failed && !item.merged}
                      <input type="number" min="0" max="1" step="0.05" bind:value={weightFixes[item.id]} />
                      <button class="btn-secondary" onclick={() => fixAndRetry(receipt.id, item.id)}>修正并重试</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <footer>
            <button class="btn-primary" disabled={remaining.length === 0} onclick={() => runImport(receipt.id)}>{receipt.items.some((item) => item.merged) && remaining.length > 0 ? '重试未并入项' : '导入回执'}</button>
            <span class="muted">{receipt.items.length - remaining.length}/{receipt.items.length} 项已并入</span>
          </footer>
          {#if result}
            {#if result.error}
              <div class="notice error">{result.error}</div>
            {/if}
            {#if result.conflicts.length > 0}
              <div class="conflict-box">
                <strong>冲突项（未覆盖现场值）</strong>
                {#each result.conflicts as conflict}
                  <div>
                    <span>{conflict.itemId} · {conflict.reason}</span>
                    <span>回执值 {conflict.incoming.relation} {conflict.incoming.weight}</span>
                    <span>现场值 {conflict.live ? `${conflict.live.relation} ${conflict.live.weight}` : '当前无此映射'}</span>
                  </div>
                {/each}
              </div>
            {/if}
            {#if result.failures.length > 0}
              <div class="notice error">导入失败，已保留原修订 {$curriculumStore.revision}：{result.failures.map((failure) => `${failure.itemId}（${failure.message}）`).join('；')}。重试只处理尚未并入的回执项。</div>
            {:else if result.merged.length > 0}
              <div class="notice success">已并入 {result.merged.length} 项{result.skipped.length ? `，跳过已并入 ${result.skipped.length} 项` : ''}，生成新修订 {result.newRevision}；图谱、覆盖矩阵与审阅队列已刷新。</div>
            {:else if !result.error}
              <div class="notice">没有可并入的回执项{result.skipped.length ? `（${result.skipped.length} 项此前已并入）` : ''}。</div>
            {/if}
          {/if}
        </article>
      {/each}
    </div>
  </section>

  <div class="review-layout">
    <section class="panel">
      <div class="panel-head"><h3>审阅队列</h3><span class="muted">{pending.length} 项待处理</span></div>
      <div class="review-list">
        {#each $curriculumStore.reviewItems as item}
          <article class:selected={selectedIds.includes(item.id)}>
            <div class="select"><input type="checkbox" checked={selectedIds.includes(item.id)} onchange={(event) => selectedIds = event.currentTarget.checked ? [...selectedIds, item.id] : selectedIds.filter((id) => id !== item.id)} /></div>
            <div class="review-main">
              <div class="review-title">
                <strong>{item.id} · {courseNames.find((node) => node.id === item.courseId)?.label.split('\n')[0]}</strong>
                <span class:approved={item.status === '已附议'} class:returned={item.status === '已退回'}>{item.status}</span>
              </div>
              <p>{item.evidence}</p>
              <small>对应 {requirements.find((node) => node.id === item.requirementId)?.label.split('\n')[0]} · {item.submitter} 提交 · 来源：{item.source}</small>
              {#if item.status === '待审阅'}
                <div class="review-actions">
                  <input bind:value={reviewComments[item.id]} placeholder="填写附议或退回意见" />
                  <button class="btn-primary" onclick={() => review(item, '已附议')}>附议</button>
                  <button class="btn-danger" onclick={() => review(item, '已退回')}>退回补充</button>
                </div>
              {:else}
                <div class:returned={item.status === '已退回'} class="decision">审阅意见：{item.comment}</div>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    </section>

    <aside class="panel">
      <div class="panel-head"><h3>提交课程修订</h3><span class="muted">服务端校验</span></div>
      <form method="POST" action="?/submitRevision" use:enhance>
        <label>课程<select name="courseId">{#each courseNames as course}<option value={course.id}>{course.id} · {course.label.split('\n')[0]}</option>{/each}</select></label>
        <label>毕业要求<select name="requirementId">{#each requirements as requirement}<option value={requirement.id}>{requirement.id} · {requirement.label.split('\n')[0]}</option>{/each}</select></label>
        <label>证据说明<textarea name="evidence" rows="4" placeholder="说明教学活动、考核记录与达成证据"></textarea></label>
        <label>修订说明<textarea name="revisionNote" rows="3" placeholder="说明本轮为什么调整映射或证据"></textarea></label>
        <label>提交人<input name="submitter" placeholder="课程负责人姓名" /></label>
        <button class="btn-primary" type="submit">提交院系审阅</button>
      </form>
      <div class="version-compare">
        <strong>R12 对比 R11</strong>
        <div><span>C-308 → GR-03</span><b>权重 0.85 → 1.00</b></div>
        <div><span>新增考核证据</span><b>需求追踪矩阵</b></div>
        <div><span>GR-06 覆盖</span><b class="returned">证据待补充</b></div>
      </div>
    </aside>
  </div>
</section>

<style>
  .actions { display: flex; gap: 8px; }
  .notice { margin-bottom: 12px; padding: 12px 14px; border-left: 3px solid #3f8869; color: #27634d; background: #ebf6f0; }
  .notice.error { border-color: #bd4d35; color: #913c2b; background: #fff1ec; }
  .receipts { margin-bottom: 14px; }
  .receipt-list { display: grid; gap: 12px; padding: 14px 16px 16px; }
  .receipt { padding: 12px 14px; border: 1px solid #e2e8e8; border-radius: 8px; }
  .receipt header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .receipt header small { display: block; margin-top: 4px; color: #839096; }
  .rev-tag { padding: 3px 8px; border-radius: 5px; color: #2e7359; background: #e7f4ec; font-size: 10px; white-space: nowrap; }
  .rev-tag.stale { color: #a94331; background: #ffebe6; }
  .receipt table { width: 100%; margin: 10px 0; border-collapse: collapse; font-size: 12px; }
  .receipt th, .receipt td { padding: 7px 8px; border-bottom: 1px solid #edf0f0; text-align: left; }
  .receipt th { color: #75848a; font-size: 10px; font-weight: 600; }
  .receipt td small { display: block; color: #839096; }
  .tag { padding: 2px 6px; border-radius: 4px; color: #9b5a25; background: #fff0de; font-size: 10px; }
  .tag.done { color: #2e7359; background: #e7f4ec; }
  .fix-cell { white-space: nowrap; }
  .fix-cell input { width: 74px; margin-right: 6px; }
  .receipt footer { display: flex; align-items: center; gap: 10px; }
  .receipt .notice { margin: 10px 0 0; }
  .conflict-box { margin-top: 10px; padding: 10px 12px; border-left: 3px solid #cd813a; background: #fff6e9; font-size: 11px; }
  .conflict-box strong { display: block; margin-bottom: 6px; }
  .conflict-box div { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; color: #6c6256; }
  .review-layout { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 14px; align-items: start; }
  .review-list { padding: 8px 16px 16px; }
  .review-list article { display: grid; grid-template-columns: 28px minmax(0,1fr); gap: 9px; padding: 14px 0; border-bottom: 1px solid #e8eded; }
  .review-list article.selected { background: #f4f8f7; }
  .review-title { display: flex; justify-content: space-between; gap: 10px; }
  .review-title span { padding: 3px 6px; border-radius: 5px; color: #9b5a25; background: #fff0de; font-size: 10px; }
  .review-title span.approved { color: #2e7359; background: #e7f4ec; }
  .review-title span.returned { color: #a94331; background: #ffebe6; }
  .review-main p { margin: 7px 0; color: #5f6e74; font-size: 12px; line-height: 1.55; }
  .review-main small { color: #839096; }
  .review-actions { display: flex; gap: 7px; margin-top: 10px; }
  .review-actions input { flex: 1; }
  .decision { margin-top: 9px; padding: 8px; color: #2f6f58; background: #edf7f1; font-size: 11px; }
  .decision.returned { color: #a54431; background: #fff0ec; }
  form { display: grid; gap: 12px; padding: 16px; }
  form button { margin-top: 3px; }
  .version-compare { margin: 0 16px 16px; padding: 12px; border: 1px solid #dbe3e3; border-radius: 8px; background: #f6f8f7; }
  .version-compare strong { display: block; margin-bottom: 9px; font-size: 12px; }
  .version-compare div { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; color: #66757b; font-size: 10px; }
  .version-compare b { color: #2e7359; }
  .version-compare b.returned { color: #aa4933; }
  @media (max-width: 1050px) { .review-layout { grid-template-columns: 1fr; } }
</style>
