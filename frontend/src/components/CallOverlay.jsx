import { useEffect, useMemo, useRef, useState } from 'react';
import { ZegoUIKitPrebuilt } from '@zegocloud/zego-uikit-prebuilt';

const CallOverlay = ({
  appId,
  serverSecret,
  roomId,
  callType,
  currentUser,
  onHangup,
  peerName,
}) => {
  const containerRef = useRef(null);
  const zegoRef = useRef(null);
  const initTimerRef = useRef(null);
  const initializedRef = useRef(false);
  const onHangupRef = useRef(onHangup);
  const [callError, setCallError] = useState('');

  useEffect(() => {
    onHangupRef.current = onHangup;
  }, [onHangup]);

  const normalizedAppId = useMemo(() => Number(String(appId || '').trim()), [appId]);
  const normalizedServerSecret = useMemo(() => String(serverSecret || '').trim(), [serverSecret]);
  const hasValidConfig =
    Number.isFinite(normalizedAppId) && normalizedAppId > 0 && normalizedServerSecret.length > 10;
  const configError = hasValidConfig ? '' : 'Calling is not configured correctly. Check ZEGO credentials.';

  useEffect(() => {
    let cancelled = false;

    if (!hasValidConfig || !roomId || !currentUser?.id) {
      return undefined;
    }

    if (!containerRef.current) {
      return undefined;
    }

    const initializeCall = () => {
      try {
        if (cancelled || !containerRef.current || initializedRef.current) {
          return;
        }

        if (!document.body.contains(containerRef.current)) {
          return;
        }

        initializedRef.current = true;

        const kitToken = ZegoUIKitPrebuilt.generateKitTokenForTest(
          normalizedAppId,
          normalizedServerSecret,
          roomId,
          String(currentUser.id),
          currentUser.name || 'User'
        );

        const zp = ZegoUIKitPrebuilt.create(kitToken);
        zegoRef.current = zp;
        setCallError('');

        zp.joinRoom({
          container: containerRef.current,
          scenario: {
            mode: ZegoUIKitPrebuilt.OneONoneCall,
          },
          turnOnMicrophoneWhenJoining: true,
          turnOnCameraWhenJoining: callType === 'video',
          showPreJoinView: false,
          showRoomTimer: true,
          onLeaveRoom: () => {
            onHangupRef.current?.();
          },
        });
      } catch (error) {
        initializedRef.current = false;
        zegoRef.current = null;
        const sdkMessage = error?.message ? ` ${error.message}` : '';
        setCallError(`Unable to start call. Please verify ZEGO AppID and Server Secret.${sdkMessage}`);
      }
    };

    // Delay init slightly so development StrictMode's first mount/unmount does not crash SDK internals.
    initTimerRef.current = window.setTimeout(() => {
      if (!cancelled) {
        initializeCall();
      }
    }, 120);

    return () => {
      cancelled = true;

      if (initTimerRef.current) {
        window.clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }

      initializedRef.current = false;

      if (zegoRef.current) {
        try {
          if (typeof zegoRef.current.hangUp === 'function') {
            zegoRef.current.hangUp();
          }
        } catch {
          // Ignore optional SDK API errors.
        }

        if (typeof zegoRef.current.destroy === 'function') {
          try {
            zegoRef.current.destroy();
          } catch {
            // Ignore cleanup errors from third-party SDK.
          }
        }

        zegoRef.current = null;
      }
    };
  }, [hasValidConfig, normalizedAppId, normalizedServerSecret, roomId, callType, currentUser?.id, currentUser?.name]);

  return (
    <div className="call-overlay" role="dialog" aria-modal="true">
      <div className="call-overlay__topbar">
        <p>{callType === 'video' ? 'Video Call' : 'Audio Call'} with {peerName}</p>
        <button type="button" className="btn btn--ghost neu-button" onClick={onHangup}>
          End
        </button>
      </div>
      {(configError || callError) && <p className="call-overlay__error">{configError || callError}</p>}
      <div className="call-overlay__stage" ref={containerRef} />
    </div>
  );
};

export default CallOverlay;
