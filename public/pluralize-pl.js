// Polish grammatical number helpers (CLDR one/few/many).
//   plPlural(1, 'prezent', 'prezenty', 'prezentów') -> 'prezent'
//   plPlural(2, ...) -> 'prezenty', plPlural(5, ...) -> 'prezentów'
//   plCount(22, 'prezent', 'prezenty', 'prezentów') -> '22 prezenty'
(function (root) {
    function plForm(n) {
        const num = Math.abs(Number(n));
        if (!Number.isInteger(num)) return 'other'; // fractions / NaN
        if (num === 1) return 'one';
        const mod10 = num % 10;
        const mod100 = num % 100;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
        return 'many';
    }

    // `other` (fractions like 1.5) uses the genitive singular in Polish
    // ("1,5 prezentu"); callers rarely need it, so it falls back to `few`
    // unless an explicit form is passed.
    function plPlural(n, one, few, many, other) {
        switch (plForm(n)) {
            case 'one': return one;
            case 'few': return few;
            case 'many': return many;
            default: return other !== undefined ? other : few;
        }
    }

    function plCount(n, one, few, many, other) {
        return `${n} ${plPlural(n, one, few, many, other)}`;
    }

    root.plForm = plForm;
    root.plPlural = plPlural;
    root.plCount = plCount;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { plForm, plPlural, plCount };
    }
})(typeof window !== 'undefined' ? window : globalThis);
