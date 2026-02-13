const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("TrustScore", function () {
  async function deployFixture() {
    const [owner, updater, other] = await ethers.getSigners();

    const MockIdentityRegistry = await ethers.getContractFactory("MockIdentityRegistry");
    const registry = await MockIdentityRegistry.deploy();
    await registry.waitForDeployment();

    await registry.setOwner(1n, owner.address);
    await registry.setOwner(2n, other.address);

    const fee = ethers.parseEther("0.0001");
    const TrustScore = await ethers.getContractFactory("TrustScore");
    const trustScore = await TrustScore.deploy(owner.address, await registry.getAddress(), updater.address, fee);
    await trustScore.waitForDeployment();

    return { owner, updater, other, registry, trustScore, fee };
  }

  it("sets constructor state", async function () {
    const { updater, registry, trustScore, fee } = await deployFixture();

    expect(await trustScore.updater()).to.equal(updater.address);
    expect(await trustScore.identityRegistry()).to.equal(await registry.getAddress());
    expect(await trustScore.queryFee()).to.equal(fee);
  });

  it("allows only updater to update score", async function () {
    const { trustScore, owner, updater } = await deployFixture();

    await expect(trustScore.connect(owner).updateScore(1n, 800n, 10n, 8n)).to.be.revertedWithCustomError(
      trustScore,
      "NotUpdater"
    );

    await expect(trustScore.connect(updater).updateScore(1n, 800n, 10n, 8n))
      .to.emit(trustScore, "ScoreUpdated")
      .withArgs(1n, 800n, anyValue);

    expect(await trustScore.getScore(1n)).to.equal(800n);
  });

  it("reverts on invalid score", async function () {
    const { trustScore, updater } = await deployFixture();

    await expect(trustScore.connect(updater).updateScore(1n, 1001n, 10n, 8n)).to.be.revertedWithCustomError(
      trustScore,
      "InvalidScore"
    );
  });

  it("reverts on inconsistent feedback counts", async function () {
    const { trustScore, updater } = await deployFixture();

    await expect(trustScore.connect(updater).updateScore(1n, 700n, 5n, 6n)).to.be.revertedWithCustomError(
      trustScore,
      "InvalidFeedbackCounts"
    );
  });

  it("reverts when updating non-registered agent", async function () {
    const { trustScore, updater } = await deployFixture();

    await expect(trustScore.connect(updater).updateScore(999n, 700n, 5n, 5n)).to.be.revertedWithCustomError(
      trustScore,
      "AgentNotRegistered"
    );
  });

  it("supports batch updates", async function () {
    const { trustScore, updater } = await deployFixture();

    await trustScore.connect(updater).batchUpdateScores([1n, 2n], [900n, 400n], [100n, 20n], [90n, 8n]);

    expect(await trustScore.getScore(1n)).to.equal(900n);
    expect(await trustScore.getScore(2n)).to.equal(400n);
  });

  it("reverts on mismatched batch array lengths", async function () {
    const { trustScore, updater } = await deployFixture();

    await expect(
      trustScore.connect(updater).batchUpdateScores([1n, 2n], [900n], [100n, 20n], [90n, 8n])
    ).to.be.revertedWithCustomError(trustScore, "ArrayLengthMismatch");
  });

  it("charges fee for paid report and allows owner withdrawal", async function () {
    const { trustScore, owner, updater, other, fee } = await deployFixture();

    await trustScore.connect(updater).updateScore(1n, 750n, 40n, 30n);

    await expect(
      trustScore.connect(other).getDetailedReportPaid(1n, { value: fee - 1n })
    ).to.be.revertedWithCustomError(trustScore, "InsufficientFee");

    await expect(trustScore.connect(other).getDetailedReportPaid(1n, { value: fee }))
      .to.emit(trustScore, "ScoreQueried")
      .withArgs(1n, other.address);

    expect(await ethers.provider.getBalance(await trustScore.getAddress())).to.equal(fee);

    await expect(trustScore.connect(owner).withdraw())
      .to.emit(trustScore, "Withdrawn")
      .withArgs(owner.address, fee);

    expect(await ethers.provider.getBalance(await trustScore.getAddress())).to.equal(0n);
  });

  it("lets owner change updater and fee", async function () {
    const { trustScore, owner, other } = await deployFixture();

    await expect(trustScore.connect(other).setUpdater(other.address)).to.be.revertedWithCustomError(
      trustScore,
      "OwnableUnauthorizedAccount"
    );

    await trustScore.connect(owner).setUpdater(other.address);
    expect(await trustScore.updater()).to.equal(other.address);

    await trustScore.connect(owner).setFee(1234n);
    expect(await trustScore.queryFee()).to.equal(1234n);
  });
});
