export function chunkDivisions(players, divisionCount) {
    // players are already sorted high → low
    const total = players.length;
    const per = Math.ceil(total / divisionCount); // keeps earlier divisions slightly bigger if uneven
    const groups = [];

    for (let i = 0; i < divisionCount; i++) {
        const start = i * per;
        const end = start + per;
        groups.push(players.slice(start, end));
    }

    return groups;
}
