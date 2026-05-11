# TranCall Translation Agent — Dockerfile
#
# Render Background Worker / Fly.io Machine / Cloud Run で共通利用できる。
# `@livekit/rtc-node` の native binding が動く Linux x86_64 ベースイメージを使う。

# ============================================================================
# Stage 1: ビルダー
# ============================================================================
FROM node:22-bookworm AS builder

# pnpm を corepack 経由で有効化（公式推奨）
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /workspace

# モノレポ全体の package.json と pnpm-lock.yaml をコピー
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY tsconfig.base.json eslint.config.ts ./

# パッケージ全体の package.json をコピー（依存解決のため）
COPY packages/shared-kernel/package.json ./packages/shared-kernel/
COPY packages/auth/package.json ./packages/auth/
COPY packages/billing/package.json ./packages/billing/
COPY packages/contact/package.json ./packages/contact/
COPY packages/media/package.json ./packages/media/
COPY packages/notification/package.json ./packages/notification/
COPY packages/room/package.json ./packages/room/
COPY packages/transcript/package.json ./packages/transcript/
COPY packages/translation/package.json ./packages/translation/
COPY packages/ui-kit/package.json ./packages/ui-kit/
COPY apps/translation-agent/package.json ./apps/translation-agent/

RUN pnpm install --frozen-lockfile

# ソースをコピー
COPY packages ./packages
COPY apps/translation-agent ./apps/translation-agent

# ビルド (translation-agent とその依存のみ)
RUN pnpm --filter=@trancall/app-translation-agent... build

# ============================================================================
# Stage 2: ランナー
# ============================================================================
FROM node:22-bookworm-slim AS runner

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# 必要最小限のファイルをコピー
COPY --from=builder /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ./
COPY --from=builder /workspace/packages ./packages
COPY --from=builder /workspace/apps/translation-agent ./apps/translation-agent

# プロダクション依存のみインストール（devDependencies を除く）
RUN pnpm install --frozen-lockfile --prod

# 非 root ユーザーで実行
RUN useradd --uid 1001 --gid root --create-home --shell /bin/bash trancall && \
    chown -R trancall:root /app
USER trancall

# Render は PORT 環境変数をセットしてくるが、Translation Agent は HTTP server を立てないので無視
# ただし graceful shutdown のため SIGTERM を尊重する（Node.js デフォルトで OK）

ENV NODE_ENV=production

# 重要: 最初のヘルスチェックでメモリ使用量が見えるようにする
CMD ["node", "apps/translation-agent/dist/src/index.js", "start"]
