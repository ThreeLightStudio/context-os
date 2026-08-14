import {
  Action,
  ActionPanel,
  Detail,
  getPreferenceValues,
  Icon,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { useState } from "react";
import { describeContextConnection } from "./connection-status";
import { checkRemoteRecordsConnection, RemoteRecordsError } from "./remote-records-api";

interface ContextPreferences {
  serverUrl?: string;
  apiToken?: string;
}

function codeBlock(value: string) {
  const longestBacktickRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}\n${value}\n${fence}`;
}

export function ContextSettingsCommand() {
  const preferences = getPreferenceValues<ContextPreferences>();
  const serverUrl = preferences.serverUrl?.trim() ?? "";
  const hasApiToken = Boolean(preferences.apiToken?.trim());
  const [connectionResult, setConnectionResult] = useState("아직 연결을 확인하지 않았습니다.");
  const connection = describeContextConnection(serverUrl, hasApiToken);

  const checkConnection = async () => {
    if (!serverUrl || !preferences.apiToken?.trim()) return;
    setConnectionResult("연결을 확인하는 중…");
    try {
      await checkRemoteRecordsConnection({ serverUrl, apiToken: preferences.apiToken, timeoutMs: 10_000 });
      setConnectionResult("연결되었습니다. API token에 read 권한이 있습니다.");
      await showToast({ style: Toast.Style.Success, title: "Context Server 연결됨" });
    } catch (error) {
      const message = error instanceof RemoteRecordsError ? error.message : "Context Server에 연결할 수 없습니다.";
      setConnectionResult(message);
      await showToast({ style: Toast.Style.Failure, title: "연결을 확인하지 못했습니다", message });
    }
  };

  return (
    <Detail
      markdown={`# Context Settings

These are the connection settings used by **Capture**, **Recent Captures**, and **Remote Records**.

## 연결 대상

**${connection.title}**

${connection.detail}

## 연결 상태

${connectionResult}

## Context Server URL

${codeBlock(serverUrl || "Not configured")}

## API token

${hasApiToken ? "Configured. The secret token is hidden." : "Not configured. Add a token with both read and write scopes in Extension Preferences."}
`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Server URL" text={serverUrl || "Not configured"} />
          <Detail.Metadata.Label title="API token" text={hasApiToken ? "Configured" : "Not configured"} />
          <Detail.Metadata.Label title="Storage mode" text={connection.title} />
          <Detail.Metadata.Label title="Records endpoint" text="/v1/records" />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action
            title="Edit Extension Preferences"
            icon={Icon.Gear}
            onAction={() => void openExtensionPreferences()}
          />
          {serverUrl && hasApiToken && (
            <Action title="Check Connection" icon={Icon.Network} onAction={() => void checkConnection()} />
          )}
          {serverUrl && <Action.CopyToClipboard title="Copy Server URL" content={serverUrl} />}
        </ActionPanel>
      }
    />
  );
}

export default function ProductionContextSettingsCommand() {
  return <ContextSettingsCommand />;
}
