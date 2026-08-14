import { Action, ActionPanel, Detail, Icon, List, getPreferenceValues, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRemoteRecordsPage, RemoteRecord, RemoteRecordsError, RecordsPage } from "./remote-records-api";

interface RemotePreferences {
  serverUrl?: string;
  apiToken?: string;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function previewFor(value: string) {
  const preview = value.replace(/\s+/g, " ").trim();
  if (!preview) return "Empty capture";
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

function RefreshAction({ onRefresh }: { onRefresh: () => void }) {
  return <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={onRefresh} />;
}

function LoadMoreAction({ onLoadMore }: { onLoadMore: () => void }) {
  return <Action title="Load More" icon={Icon.ArrowDown} onAction={onLoadMore} />;
}

function RemoteRecordDetail({
  record,
  onRefresh,
  onLoadMore,
  canLoadMore,
}: {
  record: RemoteRecord;
  onRefresh: () => void;
  onLoadMore: () => void;
  canLoadMore: boolean;
}) {
  return (
    <Detail
      markdown={`## Content\n\n${safeMarkdownCodeBlock(record.data.content)}\n\n## Metadata\n\n${safeMarkdownCodeBlock(metadataFor(record))}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Recorded" text={formatTimestamp(record.recordedAt)} />
          <Detail.Metadata.Label title="Received" text={formatTimestamp(record.receivedAt)} />
          <Detail.Metadata.Label title="Source client" text={record.data.source.client} />
          <Detail.Metadata.Label title="Schema version" text={String(record.schemaVersion)} />
          <Detail.Metadata.Label title="Record ID" text={record.id} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="Copy Content" content={record.data.content} />
          {canLoadMore && <LoadMoreAction onLoadMore={onLoadMore} />}
          <RefreshAction onRefresh={onRefresh} />
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
        setError(
          new RemoteRecordsError("configuration", "Set the Context Server URL and API token in Raycast Preferences."),
        );
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
            : new RemoteRecordsError("network", "Could not load remote records. Try again.");
        if (remoteError.code === "aborted") return;
        setError(remoteError);
        if (append) {
          await showToast({
            style: Toast.Style.Failure,
            title: "Could not load more records",
            message: remoteError.message,
          });
        }
      } finally {
        if (currentRequestId === requestId.current) setIsLoading(false);
      }
    },
    [apiToken, serverUrl],
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
      <RefreshAction onRefresh={() => void refresh()} />
      {nextCursor && <LoadMoreAction onLoadMore={() => void loadMore()} />}
    </ActionPanel>
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search remote records">
      {error && records.length === 0 ? (
        <List.EmptyView
          icon={error.code === "configuration" ? Icon.Gear : Icon.ExclamationMark}
          title="Could not load remote records"
          description={messageForError(error)}
          actions={emptyActions}
        />
      ) : records.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Document}
          title="No remote records"
          description="The Context Server returned no records."
          actions={emptyActions}
        />
      ) : (
        <>
          {records.map((record) => (
            <List.Item
              key={record.id}
              icon={Icon.Document}
              title={previewFor(record.data.content)}
              subtitle={record.data.source.client}
              accessories={[{ text: formatTimestamp(record.recordedAt) }]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Open Record"
                    target={
                      <RemoteRecordDetail
                        record={record}
                        onRefresh={() => void refresh()}
                        onLoadMore={() => void loadMore()}
                        canLoadMore={Boolean(nextCursor)}
                      />
                    }
                  />
                  <Action.CopyToClipboard title="Copy Content" content={record.data.content} />
                  {nextCursor && <LoadMoreAction onLoadMore={() => void loadMore()} />}
                  <RefreshAction onRefresh={() => void refresh()} />
                </ActionPanel>
              }
            />
          ))}
          {nextCursor && (
            <List.Item
              key="load-more"
              icon={Icon.ArrowDown}
              title="Load more records"
              subtitle="Fetch the next page from Context Server"
              actions={
                <ActionPanel>
                  <LoadMoreAction onLoadMore={() => void loadMore()} />
                  <RefreshAction onRefresh={() => void refresh()} />
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
