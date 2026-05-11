# @trancall/integration-tests

Layer 1 結合テスト。各モジュールの Facade を workspace 実装のまま使い、
Repository / Adapter には in-memory mock を DI して実際のドメインロジックを検証する。

## テスト構成

| ファイル | シナリオ | 件数 |
|--------|---------|-----|
| call-flow.integration.test.ts | 通話開始フロー全体 (billing + media + notification) | 5 |
| billing-heartbeat.integration.test.ts | heartbeat 利用量記録と超過課金 | 4 |
| contact-block.integration.test.ts | コンタクトブロック・招待リンク | 3 |
| transcript-translation.integration.test.ts | transcript 永続化と translation session | 3 |

## 実行

```
pnpm --filter=@trancall/integration-tests test
```

## 原則

- `as any` / `@ts-ignore` 禁止
- 例外 throw 禁止、Result 型
- 各 Facade は workspace 実装をそのまま import
- Repository は in-memory mock を DI
