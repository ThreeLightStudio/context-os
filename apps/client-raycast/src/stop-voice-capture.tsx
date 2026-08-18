import { Detail, showHUD, showToast, Toast } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { voiceCommand } from "./voice-capture-api";

export default function StopVoiceCaptureCommand() {
  const [message, setMessage] = useState("Stopping microphone…");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void voiceCommand("stop")
      .then((result) => {
        setMessage(`Microphone stopped. Buffer retained: ${Math.floor(result.bufferedSeconds)} seconds.`);
        return showHUD("Voice Capture stopped");
      })
      .catch(async (reason) => {
        const error = reason instanceof Error ? reason.message : "Could not stop Voice Capture.";
        setMessage(error);
        await showToast({ style: Toast.Style.Failure, title: "Voice Capture를 중지하지 못했습니다", message: error });
      });
  }, []);
  return <Detail isLoading={message === "Stopping microphone…"} markdown={`# Voice Capture\n\n${message}`} />;
}
