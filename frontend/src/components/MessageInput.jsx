import { useEffect, useRef, useState } from 'react';
import EmojiPicker from 'emoji-picker-react';

const MessageInput = ({
  disabled,
  onSend,
  onTypingStart,
  onTypingStop,
  isUploadingImage,
  replyToMessage,
  editingMessage,
  onCancelReply,
  onCancelEdit,
}) => {
  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const textInputRef = useRef(null);
  const emojiPickerRef = useRef(null);
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
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      setShowEmojiPicker(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!editingMessage) {
      return;
    }

    const editText = editingMessage.text || '';
    setText(editText);
    selectionRef.current = { start: editText.length, end: editText.length };

    requestAnimationFrame(() => {
      if (textInputRef.current) {
        textInputRef.current.focus();
        textInputRef.current.setSelectionRange(editText.length, editText.length);
      }
    });
  }, [editingMessage]);

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
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
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

  const handlePickImage = () => {
    if (disabled || isUploadingImage) {
      return;
    }
    fileInputRef.current?.click();
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

  return (
    <form className="message-input neu-raised" onSubmit={handleSubmit}>
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} />
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
      <button
        className={`btn btn--ghost neu-button message-input__attach ${selectedFile ? 'message-input__attach--active' : ''}`}
        type="button"
        onClick={handlePickImage}
        disabled={disabled || isUploadingImage || Boolean(editingMessage)}
        title="Attach image"
        aria-label="Attach image"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M16.5 6.5a4 4 0 0 0-5.7 0l-6 6a5 5 0 1 0 7.1 7.1l5.6-5.6a3 3 0 1 0-4.2-4.2l-5.3 5.3a1 1 0 1 0 1.4 1.4l4.9-4.9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

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
              ? 'Select a user to chat'
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
    </form>
  );
};

export default MessageInput;
