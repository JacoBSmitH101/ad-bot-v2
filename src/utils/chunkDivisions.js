export function chunkDivisions(players, divisionCount) {
    // players are already sorted high → low
    const total = players.length;
    const base = Math.floor(total / divisionCount);
    const remainder = total % divisionCount; // extra players go to early divisions
    const groups = [];
    let cursor = 0;

    for (let i = 0; i < divisionCount; i++) {
        const size = base + (i < remainder ? 1 : 0);
        groups.push(players.slice(cursor, cursor + size));
        cursor += size;
    }

    return groups;
}
