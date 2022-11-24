import { isWhiteSpaceLike } from "typescript"

export function eatWhitespace(text: string, pos: number) {
    const end = text.length
    while (pos < end) {
        const charCode = text.charCodeAt(pos)
        if (!isWhiteSpaceLike(charCode)) break
        pos += 1 // TODO: Might sometimes be 2 or 3?
    }
    return pos
}