package acpscreen

// The pane's keyboard, read raw. Two writers type here: the screen applet, which delivers a chat
// message as a bracketed paste (ESC[200~ … ESC[201~) followed by Enter, and occasionally a person
// typing into the pane by hand. Both end up as one submitted message per Enter; a paste keeps its
// newlines, so a multi-line chat message arrives as one prompt rather than one prompt per line.

const (
	pasteStart = "\x1b[200~"
	pasteEnd   = "\x1b[201~"
)

type inputEvent struct {
	submit    string // a finished message
	interrupt bool   // Ctrl-C
	typing    []rune // the line being typed, for echo; nil when unchanged
}

type inputParser struct {
	buf     []rune
	pending []byte // an incomplete escape sequence carried over from the last read
	inPaste bool
}

func (p *inputParser) feed(data []byte) []inputEvent {
	var out []inputEvent
	data = append(p.pending, data...)
	p.pending = nil
	changed := false
	for i := 0; i < len(data); {
		if data[i] == 0x1b {
			rest := string(data[i:])
			switch {
			case hasPrefix(rest, pasteStart):
				p.inPaste = true
				i += len(pasteStart)
				continue
			case hasPrefix(rest, pasteEnd):
				p.inPaste = false
				i += len(pasteEnd)
				continue
			case isPrefixOf(rest, pasteStart) || isPrefixOf(rest, pasteEnd) || rest == "\x1b" || rest == "\x1b[":
				p.pending = append([]byte(nil), data[i:]...) // wait for the rest of it
				i = len(data)
				continue
			}
			// Some other escape sequence (arrow keys, focus events): skip it.
			j := i + 1
			if j < len(data) && data[j] == '[' {
				j++
				for j < len(data) && (data[j] < 0x40 || data[j] > 0x7e) {
					j++
				}
			}
			i = j + 1
			continue
		}
		r, size := decodeRune(data[i:])
		i += size
		if p.inPaste {
			if r == '\r' {
				r = '\n'
			}
			p.buf = append(p.buf, r)
			changed = true
			continue
		}
		switch r {
		case '\r', '\n':
			if text := trimSpace(string(p.buf)); text != "" {
				out = append(out, inputEvent{submit: text})
			}
			p.buf = p.buf[:0]
			changed = true
		case 0x03: // Ctrl-C
			out = append(out, inputEvent{interrupt: true})
		case 0x7f, 0x08: // Backspace
			if len(p.buf) > 0 {
				p.buf = p.buf[:len(p.buf)-1]
				changed = true
			}
		case 0x15: // Ctrl-U: clear the line
			p.buf = p.buf[:0]
			changed = true
		default:
			if r >= 0x20 {
				p.buf = append(p.buf, r)
				changed = true
			}
		}
	}
	if changed {
		out = append(out, inputEvent{typing: append([]rune{}, p.buf...)})
	}
	return out
}
