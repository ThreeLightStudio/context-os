import { Action, ActionPanel, Detail, Icon, List, getPreferenceValues, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getI18n, RaycastLocalePreferences } from "./i18n";
import { fetchRemoteRecordsPage, RemoteRecord, RemoteRecordsError, RecordsPage } from "./remote-records-api";

type I18n = ReturnType<typeof getI18n>;

interface RemotePreferences extends RaycastLocalePreferences {
  serverUrl?: string;
  apiToken?: string;
}

function formatTimestamp(value: string, i18n: I18n) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : i18n.formatDate(date, { dateStyle: "medium", timeStyle: "short" });
}

function previewFor(value: string, i18n: I18n) {
  const preview = value.replace(/\s+/g, " ").trim();
  if (!preview) return i18n.t("remote.emptyCapture");
  return preview.length > 160 ? `${preview.slice(0, 157)}…` : preview;
}

function safeMarkdownCodeBlock(value: string) {
  const longestBacktickRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}\n${value}\n${fence}`;
}

function metadataFor(record: RemoteRecord) {
  return JSON.stringify(
    {
      id: record.id,
      recordedAt: record.recordedAt,
      receivedAt: record.receivedAt,
      schemaVersion: record.schemaVersion,
      data: {
        kind: record.data.kind,
        source: record.data.source,
        context: record.data.context,
      },
    },
    null,
    2,
  );
}

function RefreshAction({ onRefresh, i18n }: { onRefresh: () => void; i18n: I18n }) {
  return <Action title={i18n.t("remote.refresh")} icon={Icon.ArrowClockwise} onAction={onRefresh} />;
}

function LoadMoreAction({ onLoadMore, i18n }: { onLoadMore: () => void; i18n: I18n }) {
  return <Action title={i18n.t("remote.loadMore")} icon={Icon.ArrowDown} onAction={onLoadMore} />;
}

function RemoteRecordDetail({
  record,
  onRefresh,
  onLoadMore,
  canLoadMore,
  i18n,
}: {
  record: RemoteRecord;
  onRefresh: () => void;
  onLoadMore: () => void;
  canLoadMore: boolean;
  i18n: I18n;
}) {
  return (
    <Detail
      markdown={`## Content\n\n${safeMarkdownCodeBlock(record.data.content)}\n\n## Metadata\n\n${safeMarkdownCodeBlock(metadataFor(record))}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title={i18n.t("remote.recorded")} text={formatTimestamp(record.recordedAt, i18n)} />
          <Detail.Metadata.Label title={i18n.t("remote.received")} text={formatTimestamp(record.receivedAt, i18n)} />
          <Detail.Metadata.Label title={i18n.t("remote.sourceClient")} text={record.data.source.client} />
          <Detail.Metadata.Label title={i18n.t("remote.schemaVersion")} text={String(record.schemaVersion)} />
          <Detail.Metadata.Label title={i18n.t("remote.recordId")} text={record.id} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title={i18n.t("remote.copyContent")} content={record.data.content} />
          {canLoadMore && <LoadMoreAction onLoadMore={onLoadMore} i18n={i18n} />}
          <RefreshAction onRefresh={onRefresh} i18n={i18n} />
        </ActionPanel>
      }
    />
  );
}

function sortNewestFirst(records: RemoteRecord[]) {
  return [...records].sort((left, right) => {
    const rightTime = Date.parse(right.recordedAt);
    const leftTime = Date.parse(left.recordedAt);
    if (!Number.isNaN(rightTime) && !Number.isNaN(leftTime) && rightTime !== leftTime) return rightTime - leftTime;
    return right.recordedAt.localeCompare(left.recordedAt) || right.id.localeCompare(left.id);
  });
}

function mergeRecords(existing: RemoteRecord[], incoming: RemoteRecord[]) {
  const byId = new Map(existing.map((record) => [record.id, record]));
  incoming.forEach((record) => byId.set(record.id, record));
  return sortNewestFirst([...byId.values()]);
}

function messageForError(error: RemoteRecordsError) {
  return error.message;
}

export function RemoteRecordsCommand() {
  const preferences = getPreferenceValues<RemotePreferences>();
  const i18n = useMemo(() => getI18n(preferences), [preferences.language]);
  const serverUrl = preferences.serverUrl?.trim() ?? "";
  const apiToken = preferences.apiToken?.trim() ?? "";
  const [records, setRecords] = useState<RemoteRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<RemoteRecordsError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestId = useRef(0);
  const abortController = useRef<AbortController | null>(null);

  const loadPage = useCallback(
    async (cursor: string | undefined, append: boolean) => {
      abortController.current?.abort();
      const controller = new AbortController();
      abortController.current = controller;
      const currentRequestId = ++requestId.current;
      setIsLoading(true);
      if (!append) setError(null);

      if (!serverUrl || !apiToken) {
        setRecords([]);
        setNextCursor(null);
        setError(new RemoteRecordsError("configuration", i18n.t("connection.requiredDetail")));
        setIsLoading(false);
        return;
      }

      try {
        const page: RecordsPage = await fetchRemoteRecordsPage({
          serverUrl,
          apiToken,
          cursor,
          signal: controller.signal,
        });
        if (currentRequestId !== requestId.current) return;
        setRecords((existing) => (append ? mergeRecords(existing, page.records) : sortNewestFirst(page.records)));
        setNextCursor(page.nextCursor);
        setError(null);
      } catch (reason) {
        if (currentRequestId !== requestId.current) return;
        const remoteError =
          reason instanceof RemoteRecordsError
            ? reason
            : new RemoteRecordsError("network", i18n.t("remote.loadFailed"));
        if (remoteError.code === "aborted") return;
        setError(remoteError);
        if (append) {
          await showToast({
            style: Toast.Style.Failure,
            title: i18n.t("remote.loadMoreFailed"),
            message: remoteError.message,
          });
        }
      } finally {
        if (currentRequestId === requestId.current) setIsLoading(false);
      }
    },
    [apiToken, i18n, serverUrl],
  );

  const refresh = useCallback(() => loadPage(undefined, false), [loadPage]);
  const loadMore = useCallback(() => {
    if (nextCursor) return loadPage(nextCursor, true);
  }, [loadPage, nextCursor]);

  useEffect(() => {
    void loadPage(undefined, false);
    return () => {
      requestId.current += 1;
      abortController.current?.abort();
    };
  }, [loadPage]);

  const emptyActions = (
    <ActionPanel>
      <RefreshAction onRefresh={() => void refresh()} i18n={i18n} />
      {nextCursor && <LoadMoreAction onLoadMore={() => void loadMore()} i18n={i18n} />}
    </ActionPanel>
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder={i18n.t("remote.search")}>
      {error && records.length === 0 ? (
        <List.EmptyView
          icon={error.code === "configuration" ? Icon.Gear : Icon.ExclamationMark}
          title={i18n.t("remote.loadFailed")}
          description={messageForError(error)}
          actions={emptyActions}
        />
      ) : records.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Document}
          title={i18n.t("remote.noRecords")}
          description={i18n.t("remote.noRecordsHelp")}
          actions={emptyActions}
        />
      ) : (
        <>
          {records.map((record) => (
            <List.Item
              key={record.id}
              icon={Icon.Document}
              title={previewFor(record.data.content, i18n)}
              subtitle={record.data.source.client}
              accessories={[{ text: formatTimestamp(record.recordedAt, i18n) }]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title={i18n.t("remote.openRecord")}
                    target={
                      <RemoteRecordDetail
                        record={record}
                        onRefresh={() => void refresh()}
                        onLoadMore={() => void loadMore()}
                        canLoadMore={Boolean(nextCursor)}
                        i18n={i18n}
                      />
                    }
                  />
                  <Action.CopyToClipboard title={i18n.t("remote.copyContent")} content={record.data.content} />
                  {nextCursor && <LoadMoreAction onLoadMore={() => void loadMore()} i18n={i18n} />}
                  <RefreshAction onRefresh={() => void refresh()} i18n={i18n} />
                </ActionPanel>
              }
            />
          ))}
          {nextCursor && (
            <List.Item
              key="load-more"
              icon={Icon.ArrowDown}
              title={i18n.t("remote.loadMoreRecords")}
              subtitle={i18n.t("remote.loadMoreSubtitle")}
              actions={
                <ActionPanel>
                  <LoadMoreAction onLoadMore={() => void loadMore()} i18n={i18n} />
                  <RefreshAction onRefresh={() => void refresh()} i18n={i18n} />
                </ActionPanel>
              }
            />
          )}
        </>
      )}
    </List>
  );
}

export default function ProductionRemoteRecordsCommand() {
  return <RemoteRecordsCommand />;
}
