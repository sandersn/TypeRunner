export function const_hash(input: string) {
    // TODO: Make this better I GUESS
    return input.length ^ 17 * 61
}