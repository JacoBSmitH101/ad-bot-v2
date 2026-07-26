function finiteAverage(value) {
    const average = Number(value);
    return Number.isFinite(average) ? average : Number.NEGATIVE_INFINITY;
}

/**
 * Build balanced division groups while honouring last season's final positions.
 * Top two are promoted, bottom two are relegated, other returning players stay
 * put where possible, and remaining spaces are filled by signup average.
 *
 * @param {{
 *   signups: Array.<{discord_user_id: string, avg_3dart: number}>,
 *   previousSignupIds: Set<string>,
 *   previousDivisions: Array.<{name: string, sort_order: number}>,
 *   placementsByUser: Map<string, Array.<{
 *     divisionName: string,
 *     divisionSortOrder: number,
 *     rank: number,
 *     of: number
 *   }>>
 * }} input
 * @returns {Array.<Array.<{discord_user_id: string, avg_3dart: number}>>}
 */
export function suggestDivisionGroups({
    signups,
    previousSignupIds,
    previousDivisions,
    placementsByUser,
}) {
    if (!signups.length || !previousDivisions.length) return [];

    const divisions = [...previousDivisions].sort(
        (a, b) => a.sort_order - b.sort_order
    );
    const divisionIndexByOrder = new Map(
        divisions.map((division, index) => [division.sort_order, index])
    );
    const baseSize = Math.floor(signups.length / divisions.length);
    const remainder = signups.length % divisions.length;
    const targetSizes = divisions.map(
        (_, index) => baseSize + (index < remainder ? 1 : 0)
    );
    const assigned = divisions.map(() => []);
    const unassigned = [];

    signups.forEach((signup) => {
        const placement = [
            ...(placementsByUser.get(signup.discord_user_id) ?? []),
        ].sort((a, b) => a.divisionSortOrder - b.divisionSortOrder)[0];

        if (!previousSignupIds.has(signup.discord_user_id) || !placement) {
            unassigned.push(signup);
            return;
        }

        const previousIndex = divisionIndexByOrder.get(
            placement.divisionSortOrder
        );
        if (previousIndex === undefined) {
            unassigned.push(signup);
            return;
        }

        let divisionIndex = previousIndex;
        let reason = "returning";

        if (placement.rank <= 2 && previousIndex > 0) {
            divisionIndex -= 1;
            reason = "promoted";
        } else if (
            placement.rank > Math.max(placement.of - 2, 0) &&
            previousIndex < divisions.length - 1
        ) {
            divisionIndex += 1;
            reason = "relegated";
        }

        assigned[divisionIndex].push({ signup, reason });
    });

    // If promotion/relegation overfills a division, move the fewest ordinary
    // returners needed to the nearest division with space.
    assigned.forEach((players, divisionIndex) => {
        while (players.length > targetSizes[divisionIndex]) {
            const ordinaryReturners = players
                .map((player, index) => ({ player, index }))
                .filter(({ player }) => player.reason === "returning");
            const candidates =
                ordinaryReturners.length > 0
                    ? ordinaryReturners
                    : players.map((player, index) => ({ player, index }));
            const destinationIndex = assigned
                .map((divisionPlayers, index) => ({ divisionPlayers, index }))
                .filter(
                    ({ divisionPlayers, index }) =>
                        index !== divisionIndex &&
                        divisionPlayers.length < targetSizes[index]
                )
                .map(({ index }) => index)
                .sort(
                    (a, b) =>
                        Math.abs(a - divisionIndex) -
                            Math.abs(b - divisionIndex) || a - b
                )[0];

            if (destinationIndex === undefined) break;

            const movingDown = destinationIndex > divisionIndex;
            candidates.sort((a, b) => {
                const averageDifference =
                    finiteAverage(a.player.signup.avg_3dart) -
                    finiteAverage(b.player.signup.avg_3dart);
                return movingDown ? averageDifference : -averageDifference;
            });
            const [{ index: candidateIndex }] = candidates;
            const [player] = players.splice(candidateIndex, 1);
            assigned[destinationIndex].push({
                ...player,
                reason: "balanced",
            });
        }
    });

    // New players and returning players without a usable final position fill
    // the remaining places, strongest declared average first.
    unassigned
        .sort(
            (a, b) =>
                finiteAverage(b.avg_3dart) - finiteAverage(a.avg_3dart)
        )
        .forEach((signup) => {
            const divisionIndex = assigned.findIndex(
                (players, index) => players.length < targetSizes[index]
            );
            if (divisionIndex !== -1) {
                assigned[divisionIndex].push({
                    signup,
                    reason: previousSignupIds.has(signup.discord_user_id)
                        ? "unplaced"
                        : "new",
                });
            }
        });

    return assigned.map((players) =>
        players
            .map(({ signup }) => signup)
            .sort(
                (a, b) =>
                    finiteAverage(b.avg_3dart) -
                    finiteAverage(a.avg_3dart)
            )
    );
}
