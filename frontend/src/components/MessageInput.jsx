import { useEffect, useRef, useState } from 'react';
import EmojiPicker from 'emoji-picker-react';

const MessageInput = ({
  disabled,
  disabledReason = 'Select a user to chat',
  onSend,
  onTypingStart,
  onTypingStop,
  isUploadingImage,
  replyToMessage,
  editingMessage,
  onCancelReply,
  onCancelEdit,
  onGameInvite,
  canStartGame = false,
}) => {
  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
  const [isPdfPreviewOpen, setIsPdfPreviewOpen] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isGameInviteOpen, setIsGameInviteOpen] = useState(false);
  const [selectedGameType, setSelectedGameType] = useState('tic_tac_toe');
  const [isGameInviteSending, setIsGameInviteSending] = useState(false);
  const typingTimeoutRef = useRef(null);
  const cameraInputRef = useRef(null);
  const documentInputRef = useRef(null);
  const textInputRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const attachmentMenuRef = useRef(null);
  const selectionRef = useRef({ start: 0, end: 0 });

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!emojiPickerRef.current) {
        return;
      }

      if (!emojiPickerRef.current.contains(event.target)) {
        setShowEmojiPicker(false);
      }

      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(event.target)) {
        setIsAttachmentMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      const timer = window.setTimeout(() => {
        setShowEmojiPicker(false);
        setIsAttachmentMenuOpen(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [disabled]);

  useEffect(() => {
    if (!editingMessage) {
      return;
    }

    const editText = editingMessage.text || '';
    const raf = requestAnimationFrame(() => {
      setText(editText);
      selectionRef.current = { start: editText.length, end: editText.length };

      if (textInputRef.current) {
        textInputRef.current.focus();
        textInputRef.current.setSelectionRange(editText.length, editText.length);
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [editingMessage]);

  useEffect(() => {
    if (!selectedFile || selectedFile.type !== 'application/pdf') {
      if (pdfPreviewUrl) {
        URL.revokeObjectURL(pdfPreviewUrl);
      }
      setPdfPreviewUrl('');
      setIsPdfPreviewOpen(false);
      return undefined;
    }

    const nextUrl = URL.createObjectURL(selectedFile);
    setPdfPreviewUrl(nextUrl);
    setIsPdfPreviewOpen(true);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [selectedFile]);

  const scheduleTypingStop = () => {
    onTypingStart();

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Stop typing indicator if user pauses for 800ms.
    typingTimeoutRef.current = setTimeout(() => {
      onTypingStop();
    }, 800);
  };

  const syncSelection = (target) => {
    selectionRef.current = {
      start: target.selectionStart ?? 0,
      end: target.selectionEnd ?? 0,
    };
  };

  const handleChange = (event) => {
    const nextText = event.target.value;
    setText(nextText);
    syncSelection(event.target);
    scheduleTypingStop();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const trimmed = text.trim();
    if ((!trimmed && !selectedFile) || disabled) {
      return;
    }

    const sent = await onSend(trimmed, selectedFile, {
      replyToId: replyToMessage?._id || null,
      editingMessageId: editingMessage?._id || null,
    });
    if (sent) {
      setText('');
      setSelectedFile(null);
      if (cameraInputRef.current) {
        cameraInputRef.current.value = '';
      }
      if (documentInputRef.current) {
        documentInputRef.current.value = '';
      }
      onTypingStop();
      if (editingMessage) {
        onCancelEdit?.();
      }
      if (replyToMessage) {
        onCancelReply?.();
      }
    }
  };

  const handlePickCamera = () => {
    if (disabled || isUploadingImage) {
      return;
    }
    cameraInputRef.current?.click();
    setIsAttachmentMenuOpen(false);
  };

  const handlePickDocument = () => {
    if (disabled || isUploadingImage) {
      return;
    }
    documentInputRef.current?.click();
    setIsAttachmentMenuOpen(false);
  };

  const handleEmojiSelect = (emojiData) => {
    if (disabled) {
      return;
    }

    const emoji = emojiData.emoji;
    const start = selectionRef.current.start ?? text.length;
    const end = selectionRef.current.end ?? text.length;

    const nextText = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    const nextCursorPosition = start + emoji.length;

    setText(nextText);
    selectionRef.current = { start: nextCursorPosition, end: nextCursorPosition };
    scheduleTypingStop();

    requestAnimationFrame(() => {
      if (textInputRef.current) {
        textInputRef.current.focus();
        textInputRef.current.setSelectionRange(nextCursorPosition, nextCursorPosition);
      }
    });
  };

  const handleEmojiToggle = () => {
    if (disabled || isUploadingImage) {
      return;
    }

    const input = textInputRef.current;
    if (input) {
      syncSelection(input);
    }
    setShowEmojiPicker((prev) => !prev);
  };

  const handleImageChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setSelectedFile(file);
  };

  const openGameInvite = () => {
    if (!canStartGame || disabled) {
      return;
    }
    setIsGameInviteOpen(true);
    setSelectedGameType('tic_tac_toe');
    setIsAttachmentMenuOpen(false);
  };

  const closeGameInvite = () => {
    setIsGameInviteOpen(false);
    setIsGameInviteSending(false);
  };

  return (
    <form className="message-input neu-raised" onSubmit={handleSubmit}>
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleImageChange} />
      <input ref={documentInputRef} type="file" accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={handleImageChange} />
      {(replyToMessage || editingMessage) && (
        <div className="message-input__context">
          <div>
            <small>{editingMessage ? 'Editing message' : 'Replying to message'}</small>
            <p>
              {editingMessage
                ? editingMessage.text || 'Message'
                : replyToMessage?.deleted
                  ? 'This message was deleted'
                  : replyToMessage?.text || (replyToMessage?.imageUrl ? 'Image' : 'Message')}
            </p>
          </div>
          <button
            type="button"
            className="message-input__context-close"
            onClick={() => {
              if (editingMessage) {
                onCancelEdit?.();
              } else {
                onCancelReply?.();
              }
              setText('');
            }}
          >
            Close
          </button>
        </div>
      )}
      {selectedFile && (
        <div className={`message-input__attachment-preview ${pdfPreviewUrl ? 'message-input__attachment-preview--pdf' : ''}`}>
          <div>
            <small>Attachment</small>
            <p>{selectedFile.name || 'File'}</p>
          </div>
          {pdfPreviewUrl && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setIsPdfPreviewOpen(true)}
            >
              Preview
            </button>
          )}
          <button
            type="button"
            className="message-input__context-close"
            onClick={() => {
              setSelectedFile(null);
              if (pdfPreviewUrl) {
                URL.revokeObjectURL(pdfPreviewUrl);
                setPdfPreviewUrl('');
              }
              setIsPdfPreviewOpen(false);
              if (cameraInputRef.current) {
                cameraInputRef.current.value = '';
              }
              if (documentInputRef.current) {
                documentInputRef.current.value = '';
              }
            }}
          >
            Remove
          </button>
        </div>
      )}
      <div className="message-input__attach-menu" ref={attachmentMenuRef}>
        <button
          className={`btn btn--ghost neu-button message-input__attach ${selectedFile ? 'message-input__attach--active' : ''}`}
          type="button"
          onClick={() => setIsAttachmentMenuOpen((prev) => !prev)}
          disabled={disabled || isUploadingImage || Boolean(editingMessage)}
          title="Open attachments"
          aria-label="Open attachments"
        >
          <span className="message-input__attach-plus">+</span>
        </button>
        {isAttachmentMenuOpen && (
          <div className="attachment-menu">
            <button type="button" className="attachment-menu__item" onClick={handlePickDocument}>
              📄 Document
            </button>
            <button type="button" className="attachment-menu__item" onClick={handlePickCamera}>
              📷 Camera
            </button>
            <button
              type="button"
              className="attachment-menu__item"
              onClick={openGameInvite}
              disabled={!canStartGame}
              title={!canStartGame ? 'Games are available in direct chats' : 'Start a game'}
            >
              🎮 Game
            </button>
          </div>
        )}
      </div>

      <div className="message-input__emoji-wrap" ref={emojiPickerRef}>
        <button
          className={`btn btn--ghost neu-button message-input__emoji ${showEmojiPicker ? 'message-input__emoji--active' : ''}`}
          type="button"
          onClick={handleEmojiToggle}
          disabled={disabled || isUploadingImage}
          title="Add emoji"
          aria-label="Add emoji"
        >
          <span role="img" aria-hidden="true">
            😊
          </span>
        </button>

        {showEmojiPicker && (
          <div className={`message-input__emoji-popover ${showEmojiPicker ? 'is-open' : ''}`}>
            <EmojiPicker
              onEmojiClick={handleEmojiSelect}
              autoFocusSearch={false}
              searchDisabled={false}
              skinTonesDisabled
              previewConfig={{ showPreview: false }}
              lazyLoadEmojis
              width="100%"
            />
          </div>
        )}
      </div>

      <div className="message-input__field-wrap">
        <input
          ref={textInputRef}
          type="text"
          placeholder={
            disabled
              ? disabledReason
              : editingMessage
                ? 'Edit message...'
                : selectedFile
                  ? 'Add description (optional)...'
                  : 'Type a message...'
          }
          value={text}
          onChange={handleChange}
          onClick={(event) => syncSelection(event.target)}
          onKeyUp={(event) => syncSelection(event.target)}
          onSelect={(event) => syncSelection(event.target)}
          disabled={disabled}
        />
      </div>
      <button
        className="btn btn--primary neu-button"
        type="submit"
        disabled={disabled || (!text.trim() && !selectedFile) || isUploadingImage}
      >
        {isUploadingImage ? 'Uploading...' : editingMessage ? 'Save' : 'Send'}
      </button>

      {isGameInviteOpen && (
        <div className="modal-overlay" onClick={closeGameInvite} role="presentation">
          <div className="add-members-modal" onClick={(event) => event.stopPropagation()}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}>
                <h4>Start a game</h4>
                <button
                  type="button"
                  className="member-menu-btn"
                  onClick={closeGameInvite}
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <button
                type="button"
                className={`game-option ${selectedGameType === 'tic_tac_toe' ? 'is-selected' : ''}`}
                onClick={() => setSelectedGameType('tic_tac_toe')}
              >
                <span className="game-option__title">Tic Tac Toe</span>
                <small>Classic 2-player grid</small>
              </button>
              <button
                type="button"
                className={`game-option ${selectedGameType === 'quiz' ? 'is-selected' : ''}`}
                onClick={() => setSelectedGameType('quiz')}
              >
                <span className="game-option__title">Quiz</span>
                <small>Take turns answering questions</small>
              </button>
            </div>
            <div>
              <button type="button" className="btn btn--ghost" onClick={closeGameInvite}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={isGameInviteSending}
                onClick={async () => {
                  setIsGameInviteSending(true);
                  const ok = await onGameInvite?.(selectedGameType);
                  if (ok) {
                    closeGameInvite();
                  }
                  setIsGameInviteSending(false);
                }}
              >
                Send invite
              </button>
            </div>
          </div>
        </div>
      )}

      {isPdfPreviewOpen && pdfPreviewUrl && (
        <div className="modal-overlay" onClick={() => setIsPdfPreviewOpen(false)} role="presentation">
          <div className="file-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="file-preview-modal__header">
              <div>
                <h4>{selectedFile?.name || 'PDF Preview'}</h4>
                <p>PDF document</p>
              </div>
              <button
                type="button"
                className="member-menu-btn"
                onClick={() => setIsPdfPreviewOpen(false)}
                title="Close"
              >
                ✕
              </button>
            </div>
            <iframe
              className="file-preview-modal__frame"
              src={`${pdfPreviewUrl}#page=1&view=FitH`}
              title="PDF preview"
            />
          </div>
        </div>
      )}
    </form>
  );
};

export default MessageInput;
