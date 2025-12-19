export function roundRobin(playerIds) {
    // returns weeks: [ [ [a,b], [c,d] ], ... ]
    const players = [...playerIds];

    if (players.length < 2) return [];

    const hasBye = players.length % 2 === 1;
    if (hasBye) players.push("BYE");

    const n = players.length;
    const rounds = n - 1;
    const half = n / 2;

    const weeks = [];

    for (let r = 0; r < rounds; r++) {
        const pairs = [];
        for (let i = 0; i < half; i++) {
            const a = players[i];
            const b = players[n - 1 - i];
            if (a !== "BYE" && b !== "BYE") pairs.push([a, b]);
        }
        weeks.push(pairs);

        // rotate (keep first fixed)
        const fixed = players[0];
        const rest = players.slice(1);
        rest.unshift(rest.pop());
        players.splice(0, players.length, fixed, ...rest);
    }

    return weeks;
}
