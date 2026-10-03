<script lang="ts">
  import { curriculumStore } from '$lib/stores'
  import type { ImportResult } from '$lib/stores'
  import { sampleReceipts } from '$lib/seed'

  let pasted = $state('')
  let result = $state<ImportResult | null>(null)
  let fileName = $state('')

  const receipts = $derived($curriculumStore.receipts)
  const revision = $derived($curriculumStore.revision)
  const locked = $derived($curriculumStore.locked)
  const unmergedCount = $derived(receipts.reduce((total, receipt) => total + receipt.items.filter((item) => !item.merged).length, 0))
  const mergedCount = $derived(receipts.reduce((total, receipt) => total + receipt.items.filter((item) => item.merged).length, 0))

  function runImport(data: unknown) {
    result = curriculumStore.importReceipts(data)
  }

  function importStored() {
    runImport({ receipts: $curriculumStore.receipts })
  }

  function loadSamples() {
    runImport({ receipts: sampleReceipts })
  }

  function onFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    fileName = file.name
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        pasted = JSON.stringify(data, null, 2)
        runImport(data)
      } catch {
        result = { ok: false, error: '无法解析回执文件，请确认是合法 JSON。', merged: [], conflicts: [], newRevision: '', previousRevision: '' }
      }
    }
    reader.readAsText(file)
  }

  function importPasted() {
    try {
      const data = JSON.parse(pasted)
      runImport(data)
    } catch {
      result = { ok: false, error: '无法解析粘贴的 JSON，请检查格式。', merged: [], conflicts: [], newRevision: '', previousRevision: '' }
    }
  }

  function downloadTemplate() {
    const blob = new Blob([JSON.stringify({ receipts: sampleReceipts }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = '回执模板.json'
    link.click()
    URL.revokeObjectURL(url)
  }
</script>

<svelte:head><title>回执合并与版本刷新</title></svelte:head>

<section class="page">
  <div class="page-head">
    <div><p class="eyebrow">RECEIPT MERGE / 回执合并</p><h1>离线审阅回执导入与合并</h1><p class="muted">多组老师离线审阅同一份课程修订后交回回执；导入时与当前修订比对，过期或超出教师范围的映射不覆盖，只列出冲突与现场值。</p></div>
    <div class="actions">
      <button class="btn-secondary" onclick={downloadTemplate}>下载回执模板</button>
      <button class="btn-secondary" onclick={loadSamples}>载入示例回执</button>
      <button class="btn-primary" onclick={importStored} disabled={unmergedCount === 0}>导入回执并合并{unmergedCount ? `（${unmergedCount} 项待处理）` : ''}</button>
    </div>
  </div>

  {#if result}
    {#if result.ok}
      <div class="notice success">
        导入完成：{result.merged.length} 项无冲突已并入{#if result.newRevision !== result.previousRevision}，修订由 {result.previousRevision} 刷新为 {result.newRevision}{/if}；{result.conflicts.length} 项冲突未覆盖。
      </div>
    {:else}
      <div class="notice error">导入失败，已保留原修订 {result.previousRevision || revision}：{result.error}</div>
    {/if}
  {/if}

  <div class="receipt-layout">
    <section class="panel">
      <div class="panel-head"><h3>导入回执</h3><span class="muted">当前版本 {revision}{locked ? ' · 已锁定' : ''}</span></div>
      <div class="import-body">
        <label class="file-drop">
          <span>选择回执 JSON 文件</span>
          <input type="file" accept=".json,application/json" onchange={onFile} />
          {#if fileName}<small>已选择：{fileName}</small>{/if}
        </label>
        <div class="divider"><span>或</span></div>
        <label>粘贴回执 JSON<textarea bind:value={pasted} rows="8" placeholder="粘贴回执 JSON，可点击上方「下载回执模板」获取格式后填入"></textarea></label>
        <button class="btn-primary" onclick={importPasted} disabled={!pasted.trim()}>解析并导入</button>
      </div>
    </section>

    <aside class="panel">
      <div class="panel-head"><h3>冲突与现场值</h3><span class="muted">{result?.conflicts.length ?? 0} 项</span></div>
      <div class="conflict-list">
        {#if result && result.ok && result.conflicts.length > 0}
          {#each result.conflicts as conflict}
            <article class:expired={conflict.reason === '已过期'}>
              <div class="conflict-head">
                <strong>{conflict.itemId}</strong>
                <span class="reason">{conflict.reason}</span>
              </div>
              <p class="conflict-meta">{conflict.receiptSource} · {conflict.courseId} → {conflict.requirementId}</p>
              <div class="value-grid">
                <div><span>回执建议</span><b>{conflict.proposedStatus}</b><small>{conflict.proposedComment || '—'}</small></div>
                <div><span>现场值</span><b>{conflict.liveStatus ?? '无'}</b><small>{conflict.liveComment || conflict.liveEvidence || '—'}</small></div>
              </div>
            </article>
          {/each}
        {:else if result && result.ok}
          <div class="empty">本次导入无冲突，所有回执项均已并入。</div>
        {:else}
          <div class="empty">导入后将在此列出过期或超出教师范围的回执项。</div>
        {/if}
      </div>
    </aside>
  </div>

  <section class="panel">
    <div class="panel-head"><h3>已导入回执</h3><span class="muted">{mergedCount} 项已并入 · {unmergedCount} 项待处理</span></div>
    <div class="receipt-list">
      {#if receipts.length === 0}
        <div class="empty">暂无回执，可载入示例或下载模板后导入。</div>
      {:else}
        {#each receipts as receipt}
          <article>
            <div class="receipt-head">
              <strong>{receipt.source}</strong>
              <span class="muted">{receipt.id} · 收到版本 {receipt.receivedRevision} · 负责范围 {receipt.scope.join('、')}</span>
            </div>
            <ul>
              {#each receipt.items as item}
                <li class:merged={item.merged}>
                  <span class="item-id">{item.id}</span>
                  <span class="item-meta">{item.courseId} → {item.requirementId}</span>
                  <span class="item-status">{item.status}</span>
                  <span class="item-comment">{item.comment || '—'}</span>
                  <span class="item-flag">{item.merged ? '已并入' : '待处理'}</span>
                </li>
              {/each}
            </ul>
          </article>
        {/each}
      {/if}
    </div>
  </section>
</section>

<style>
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .notice { margin-bottom: 12px; padding: 12px 14px; border-left: 3px solid #3f8869; color: #27634d; background: #ebf6f0; }
  .notice.error { border-color: #bd4d35; color: #913c2b; background: #fff1ec; }
  .receipt-layout { display: grid; grid-template-columns: minmax(0,1fr) 380px; gap: 14px; align-items: start; margin-bottom: 14px; }
  .import-body { display: grid; gap: 12px; padding: 16px; }
  .file-drop { display: grid; gap: 6px; padding: 18px; border: 1px dashed #b9c9c8; border-radius: 8px; text-align: center; color: #537579; font-size: 12px; cursor: pointer; }
  .file-drop input { display: none; }
  .file-drop small { color: #839096; }
  .divider { position: relative; text-align: center; color: #9aa6ab; font-size: 11px; }
  .divider::before { content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: #e3e9e9; }
  .divider span { position: relative; padding: 0 10px; background: white; }
  .conflict-list { padding: 8px 16px 16px; }
  .conflict-list article { padding: 12px 0; border-bottom: 1px solid #edf0f0; }
  .conflict-list article.expired .reason { color: #a54431; background: #ffebe6; }
  .conflict-head { display: flex; align-items: center; justify-content: space-between; }
  .conflict-head strong { font-size: 13px; }
  .reason { padding: 3px 7px; border-radius: 5px; color: #9b5a25; background: #fff0de; font-size: 10px; }
  .conflict-meta { margin: 5px 0 8px; color: #839096; font-size: 11px; }
  .value-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .value-grid > div { display: grid; gap: 3px; padding: 8px; border: 1px solid #e0e6e6; border-radius: 6px; background: #f8faf9; }
  .value-grid span { color: #839096; font-size: 10px; }
  .value-grid b { color: #2d7375; font-size: 12px; }
  .value-grid small { color: #66757b; font-size: 10px; line-height: 1.4; }
  .receipt-list { display: grid; gap: 12px; padding: 16px; }
  .receipt-list article { border: 1px solid #e0e6e6; border-radius: 8px; overflow: hidden; }
  .receipt-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; background: #f5f8f8; }
  .receipt-head strong { font-size: 13px; }
  .receipt-head span { font-size: 11px; }
  .receipt-list ul { margin: 0; padding: 0; list-style: none; }
  .receipt-list li { display: grid; grid-template-columns: 90px 1fr 80px 1.2fr 70px; gap: 10px; align-items: center; padding: 9px 14px; border-top: 1px solid #edf0f0; font-size: 11px; }
  .receipt-list li.merged { background: #f4f9f6; }
  .item-id { color: #537579; font-weight: 700; }
  .item-meta { color: #66757b; }
  .item-status { color: #2d7375; font-weight: 700; }
  .item-comment { color: #839096; }
  .item-flag { text-align: right; color: #9b5a25; font-size: 10px; }
  .receipt-list li.merged .item-flag { color: #2e7359; }
  .empty { padding: 22px 0; color: #3d7b63; font-size: 12px; }
  @media (max-width: 1050px) { .receipt-layout { grid-template-columns: 1fr; } .receipt-list li { grid-template-columns: 70px 1fr 70px; } .item-comment, .item-meta { display: none; } }
</style>
