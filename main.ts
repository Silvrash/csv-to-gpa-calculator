import puppeteer = require("puppeteer");
import csv = require("csvtojson");
import path = require("path");
import { stringify } from "csv-stringify/sync";
import { existsSync, mkdirSync, writeFileSync } from "fs";

interface Output {
    Course: string;
    Credits: string;
    Grade: string;
    "US Grade": string;
    "Grade Points": string;
}

const OUTPUT_FOLDER = path.join(__dirname, "output");

async function inputCourse(
    page: puppeteer.Page,
    rowNo: number,
    name: string,
    credits: string,
    grade: string
) {
    // Fill name on <input> tr:nth-child(2) > td:nth-child(2) > input
    await page.type(`tr:nth-child(${rowNo}) > td:nth-child(2) > input`, name);

    // Fill credits on <input> tr:nth-child(2) > td:nth-child(3) > input
    await page.type(`tr:nth-child(${rowNo}) > td:nth-child(3) > input`, credits);

    // Fill grade on <input> tr:nth-child(2) > td:nth-child(4) > input
    await page.type(`tr:nth-child(${rowNo}) > td:nth-child(4) > input`, grade);
}

async function addNewRows(page: puppeteer.Page, rows: number) {
    // Fill "30" on <input> #ctl00_ctl00_ContentPlaceHolder1_ContentPlaceHolder1_CountText
    await page.type(
        "#ctl00_ctl00_ContentPlaceHolder1_ContentPlaceHolder1_CountText",
        rows.toString()
    );

    // Click on "Add" button
    await page.click("#ctl00_ctl00_ContentPlaceHolder1_ContentPlaceHolder1_AddButton");
}

async function createConvertedCSV(page: puppeteer.Page, rowsToExpect: number) {
    const output: Output[] = [];

    for (let index = 1; index < rowsToExpect; index++) {
        const rowSelector = `#Table2 > tbody > tr:nth-child(${index + 1})`;
        await page.waitForSelector(rowSelector);
        const course = await page.$eval(`${rowSelector} > td:nth-child(2)`, (e) => e.textContent);
        const credits = await page.$eval(`${rowSelector} > td:nth-child(3)`, (e) => e.textContent);
        const grade = await page.$eval(`${rowSelector} > td:nth-child(4)`, (e) => e.textContent);
        const usGrade = await page.$eval(`${rowSelector} > td:nth-child(5)`, (e) => e.textContent);
        const gradePoints = await page.$eval(
            `${rowSelector} > td:nth-child(6)`,
            (e) => e.textContent
        );
        output.push({
            Course: course,
            Credits: credits,
            Grade: grade,
            "US Grade": usGrade,
            "Grade Points": gradePoints,
        });
    }

    const cGPA = await page.$eval("#cGPA", (e) => e.textContent);
    const [text, points] = cGPA.split(":");
    output.push({ Course: "", Credits: "", Grade: "", "US Grade": "", "Grade Points": "" });
    output.push({
        Course: text.trim(),
        Credits: "",
        Grade: "",
        "US Grade": "",
        "Grade Points": points.trim(),
    });

    writeFileSync(
        path.join(OUTPUT_FOLDER, "gpa.csv"),
        stringify(output, { header: true }).toString()
    );
    return points.trim();
}

async function main(headless = true) {
    const csvFilePath = path.join(__dirname, "./transcript.csv");
    const transcript = await csv().fromFile(csvFilePath);

    const browser = await puppeteer.launch({
        headless,
    });
    const [page] = await browser.pages();
    await page.goto("https://www.scholaro.com/gpa-calculator/Ghana", {
        waitUntil: "networkidle2",
    });

    const existingRows = (await page.$$("table.FrontPage.input tr")).length;
    const rowsToAdd = transcript.length + 1 - existingRows;

    await addNewRows(page, rowsToAdd);

    for (let index = 1; index < transcript.length + 1; index++) {
        const row = transcript[index - 1];
        await inputCourse(page, index + 1, row["COURSE NAME"], row["CREDITS"], row["GRADE"]);
    }

    // calculate gpa button
    await page.click("#ctl00_ctl00_ContentPlaceHolder1_ContentPlaceHolder1_CalculateGPARadButton");

    if (!existsSync(OUTPUT_FOLDER)) mkdirSync(OUTPUT_FOLDER, { recursive: true });

    const points = await createConvertedCSV(page, transcript.length + 1);

    await page.screenshot({ path: path.join(OUTPUT_FOLDER, "screenshot.png"), fullPage: true });

    if (headless) {
        await page.pdf({
            path: path.join(OUTPUT_FOLDER, "gpa.pdf"),
        });
    }

    console.log("Cumulative GPA: ", points);
    await browser.close();
}

main()
    .then(() => process.exit())
    .catch((e) => {
        console.error(e);
        process.exit();
    });
